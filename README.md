# MRA Plan Viewer

This is a simple leaflet map that shows the MRA mine plans that I have digitised and uploaded to a Cloudflare R2 bucket for use as an XYZ tile server.

## Process

1. [Find](https://datamine-cauk.hub.arcgis.com/) or [search for](https://mine-plans.bgs.ac.uk/home.html) a mine plan and get it's ID.
2. Use `dezoomify` to download it at a high resolution.
3. Georeference it in QGIS.
4. Convert the resultant Tiff to a COG: `gdal_translate -of COG -co COMPRESS=DEFLATE -co PREDICTOR=2 georeferenced.tif cog.tif`
5. Cut it into XYZ tiles: `gdal raster tile --min-zoom=12 --max-zoom=18 --of WEBP --co QUALITY=50 --webviewer none cog.tif ~/Documents/tiles/mra/{PLAN_ID}/`
6. Upload it to my R2 bucket: `rclone copy ~/Documents/tiles/mra/{PLAN_ID}/ cloudflare-r2-tiles:tiles/mra/{PLAN_ID} --progress --transfers 32 --checkers 32`
7. Iterate through my plans directory to generate a metadata JSON: `python build_planjson.py ./MRA -o plans.json`
8. `git push`

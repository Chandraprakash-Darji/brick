/** Renders the Scalar API reference page for the given OpenAPI URL. */
export function scalarDocsHTML(specUrl: string, title: string): string {
  return `<!doctype html>
<html>
  <head>
    <title>${title} — API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="https://scalar.com/favicon.svg" />
    <style>
      body { margin: 0; padding: 0; height: 100vh; }
    </style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="${specUrl}"
      data-configuration='{"theme": "purple", "layout": "modern"}'
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference">
    </script>
  </body>
</html>`;
}


export function swaggerDocsHTML(openApiPath: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>${title} — Swagger UI</title>
    <link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
      *, *:before, *:after { box-sizing: inherit; }
      body { margin:0; background: #fafafa; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" charset="UTF-8"></script>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js" charset="UTF-8"></script>
    <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "${openApiPath}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
    };
    </script>
  </body>
</html>`;
}

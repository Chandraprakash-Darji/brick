/**
 * The page the dashboard serves at `/`. The React app and its styles load from
 * `/assets/`; the inline script applies the saved theme before first paint. The
 * import map lets the project's own docs components, bundled apart from the
 * dashboard, share its copy of React.
 */
export const DEV_DASHBOARD_SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brick dev</title>
<link rel="icon" href="data:,">
<script>
(function () {
  try {
    var theme = localStorage.getItem("brick-dashboard-theme");
    var dark = theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (error) {}
})();
</script>
<link rel="stylesheet" href="/assets/app.css">
<script type="importmap">
{"imports":{"react":"/assets/react.js","react/jsx-runtime":"/assets/react-jsx-runtime.js","react/jsx-dev-runtime":"/assets/react-jsx-runtime.js"}}
</script>
</head>
<body>
<div id="root"></div>
<script type="module" src="/assets/app.js"></script>
</body>
</html>
`;

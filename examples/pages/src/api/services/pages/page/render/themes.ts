/** Full page stylesheet for a theme; unknown themes fall back to github-dark. */
export function pageThemeCSS(theme: string): string {
  switch (theme) {
    case "github-light":
      return githubLightCSS;
    case "dracula":
      return draculaCSS;
    case "nord":
      return nordCSS;
    default:
      return githubDarkCSS;
  }
}

const githubDarkCSS = `
.markdown-body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";--md-bg:#0d1117;--md-fg:#e6edf3;--md-muted:#8b949e;--md-border:#30363d;--md-link:#2f81f7;background:#0d1117;color:#e6edf3;font-size:16px;line-height:1.65;min-height:100vh}
.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{font-weight:700;line-height:1.25;margin:1.5em 0 .6em}
.markdown-body h1{font-size:2em;border-bottom:1px solid #30363d;padding-bottom:.3em}
.markdown-body h2{font-size:1.5em;border-bottom:1px solid #30363d;padding-bottom:.3em}
.markdown-body h3{font-size:1.25em}
.markdown-body p,.markdown-body ul,.markdown-body ol,.markdown-body blockquote,.markdown-body table{margin:0 0 1em}
.markdown-body ul,.markdown-body ol{padding-left:1.6em}
.markdown-body a{color:#2f81f7;text-decoration:none}
.markdown-body a:hover{text-decoration:underline}
.markdown-body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.875em;background:#161b22;color:#e6edf3;padding:.2em .4em;border-radius:6px}
.markdown-body pre{background:#161b22;border-radius:8px;padding:16px;overflow:auto;margin:0 0 1em}
.markdown-body pre code{background:0 0;padding:0;font-size:.875em}
.markdown-body blockquote{border-left:.25em solid #30363d;color:#8b949e;padding:0 1em}
.markdown-body table{border-collapse:collapse;width:100%}
.markdown-body th,.markdown-body td{border:1px solid #30363d;padding:6px 13px}
.markdown-body hr{border:none;border-top:1px solid #30363d;margin:1.5em 0}
.markdown-body img{max-width:100%}
`;

const githubLightCSS = `
.markdown-body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";--md-bg:#fff;--md-fg:#1f2328;--md-muted:#656d76;--md-border:#d0d7de;--md-link:#0969da;background:#fff;color:#1f2328;font-size:16px;line-height:1.65;min-height:100vh}
.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{font-weight:700;line-height:1.25;margin:1.5em 0 .6em}
.markdown-body h1{font-size:2em;border-bottom:1px solid #d0d7de;padding-bottom:.3em}
.markdown-body h2{font-size:1.5em;border-bottom:1px solid #d0d7de;padding-bottom:.3em}
.markdown-body h3{font-size:1.25em}
.markdown-body p,.markdown-body ul,.markdown-body ol,.markdown-body blockquote,.markdown-body table{margin:0 0 1em}
.markdown-body ul,.markdown-body ol{padding-left:1.6em}
.markdown-body a{color:#0969da;text-decoration:none}
.markdown-body a:hover{text-decoration:underline}
.markdown-body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.875em;background:#f6f8fa;color:#1f2328;padding:.2em .4em;border-radius:6px}
.markdown-body pre{background:#f6f8fa;border-radius:8px;padding:16px;overflow:auto;margin:0 0 1em}
.markdown-body pre code{background:0 0;padding:0;font-size:.875em}
.markdown-body blockquote{border-left:.25em solid #d0d7de;color:#656d76;padding:0 1em}
.markdown-body table{border-collapse:collapse;width:100%}
.markdown-body th,.markdown-body td{border:1px solid #d0d7de;padding:6px 13px}
.markdown-body hr{border:none;border-top:1px solid #d0d7de;margin:1.5em 0}
.markdown-body img{max-width:100%}
`;

const draculaCSS = `
.markdown-body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";--md-bg:#282a36;--md-fg:#f8f8f2;--md-muted:#6272a4;--md-border:#44475a;--md-link:#8be9fd;background:#282a36;color:#f8f8f2;font-size:16px;line-height:1.65;min-height:100vh}
.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{font-weight:700;line-height:1.25;margin:1.5em 0 .6em}
.markdown-body h1{font-size:2em;border-bottom:1px solid #44475a;padding-bottom:.3em}
.markdown-body h2{font-size:1.5em;border-bottom:1px solid #44475a;padding-bottom:.3em}
.markdown-body h3{font-size:1.25em}
.markdown-body p,.markdown-body ul,.markdown-body ol,.markdown-body blockquote,.markdown-body table{margin:0 0 1em}
.markdown-body ul,.markdown-body ol{padding-left:1.6em}
.markdown-body a{color:#8be9fd;text-decoration:none}
.markdown-body a:hover{text-decoration:underline}
.markdown-body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.875em;background:#21222c;color:#f8f8f2;padding:.2em .4em;border-radius:6px}
.markdown-body pre{background:#21222c;border-radius:8px;padding:16px;overflow:auto;margin:0 0 1em}
.markdown-body pre code{background:0 0;padding:0;font-size:.875em}
.markdown-body blockquote{border-left:.25em solid #44475a;color:#6272a4;padding:0 1em}
.markdown-body table{border-collapse:collapse;width:100%}
.markdown-body th,.markdown-body td{border:1px solid #44475a;padding:6px 13px}
.markdown-body hr{border:none;border-top:1px solid #44475a;margin:1.5em 0}
.markdown-body img{max-width:100%}
`;

const nordCSS = `
.markdown-body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";--md-bg:#2e3440;--md-fg:#eceff4;--md-muted:#9aa5b1;--md-border:#434c5e;--md-link:#88c0d0;background:#2e3440;color:#eceff4;font-size:16px;line-height:1.65;min-height:100vh}
.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{font-weight:700;line-height:1.25;margin:1.5em 0 .6em}
.markdown-body h1{font-size:2em;border-bottom:1px solid #434c5e;padding-bottom:.3em}
.markdown-body h2{font-size:1.5em;border-bottom:1px solid #434c5e;padding-bottom:.3em}
.markdown-body h3{font-size:1.25em}
.markdown-body p,.markdown-body ul,.markdown-body ol,.markdown-body blockquote,.markdown-body table{margin:0 0 1em}
.markdown-body ul,.markdown-body ol{padding-left:1.6em}
.markdown-body a{color:#88c0d0;text-decoration:none}
.markdown-body a:hover{text-decoration:underline}
.markdown-body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.875em;background:#3b4252;color:#eceff4;padding:.2em .4em;border-radius:6px}
.markdown-body pre{background:#3b4252;border-radius:8px;padding:16px;overflow:auto;margin:0 0 1em}
.markdown-body pre code{background:0 0;padding:0;font-size:.875em}
.markdown-body blockquote{border-left:.25em solid #434c5e;color:#d8dee9;padding:0 1em}
.markdown-body table{border-collapse:collapse;width:100%}
.markdown-body th,.markdown-body td{border:1px solid #434c5e;padding:6px 13px}
.markdown-body hr{border:none;border-top:1px solid #434c5e;margin:1.5em 0}
.markdown-body img{max-width:100%}
`;

export const tocCSS = `
html{scroll-behavior:smooth;scroll-padding-top:2rem}
.toc{position:fixed;right:1rem;top:50%;transform:translateY(-50%);z-index:40;display:none}
@media(min-width:1024px){.toc{display:block}}
.toc-trigger{display:flex;flex-direction:column;align-items:flex-end;gap:5px;padding:2px 0;padding-left:12px;}
.toc-dash{display:block;height:2px;border-radius:9999px;background:color-mix(in srgb,var(--md-muted) 55%,transparent);cursor:pointer;transition:width .2s,background .2s,transform .3s,opacity .3s}
.toc-dash:hover{background:var(--md-fg)}
.toc-dash.active{background:var(--md-link)}
.toc-d1{width:40px}.toc-d2{width:24px}.toc-d3{width:12px}
.toc-popover{position:absolute;right:100%;top:50%;transform:translateY(-50%);min-width:12rem;max-width:18rem;border:1px solid var(--md-border);background:var(--md-bg);border-radius:8px;padding:8px 0;box-shadow:0 12px 32px -8px rgba(0,0,0,.45);opacity:0;visibility:hidden;transition:opacity .15s;max-height:80svh; overflow-y:scroll;}
.toc:hover .toc-popover{opacity:1;visibility:visible}
.toc-popover ul{list-style:none;margin:0;padding:0}
.toc-link{display:block;border-left:2px solid transparent;padding:4px 16px;font-size:12px;color:var(--md-muted);text-decoration:none;line-height:1.4;transition:color .15s,border-color .15s}
.toc-link:hover{color:var(--md-fg);border-left-color:var(--md-muted)}
.toc-link.active{color:var(--md-fg);border-left-color:var(--md-link);font-weight:600}
`;

export const headingCSS = `
.markdown-body :is(h1,h2,h3,h4,h5,h6){position:relative;scroll-margin-top:2rem;display:block;margin-right:.5rem;width:fit-content;}
.markdown-body :is(h1,h2,h3,h4,h5,h6)>a.heading-anchor{position:absolute;top:0;bottom:0;left:0;width:100%;background-image:none;transition:none;border:0;margin:0;display:block}
.heading-anchor{margin-left:.4em;text-decoration:none;font-weight:500;opacity:0;transition:opacity .2s}
.markdown-body :is(h1,h2,h3,h4,h5,h6):hover .heading-anchor{opacity:1}
.heading-anchor::after{content:"#";position:absolute;right:-1.25rem;top:50%;transform:translate(0,-50%);}
`;

export const tocScript = `
<script>
(function(){
  var toc=document.getElementById('toc');
  if(!toc)return;
  var dashes=[].slice.call(toc.querySelectorAll('.toc-dash'));
  var links=[].slice.call(toc.querySelectorAll('.toc-link'));
  function setActive(id){
    dashes.forEach(function(d){d.classList.toggle('active',d.dataset.target===id)});
    links.forEach(function(l){l.classList.toggle('active',l.dataset.target===id)});
  }
  var observer=new IntersectionObserver(function(entries){
    entries.forEach(function(e){if(e.isIntersecting)setActive(e.target.id)});
  },{rootMargin:'-80px 0px -60% 0px',threshold:0});
  dashes.forEach(function(d){
    var el=document.getElementById(d.dataset.target);
    if(el)observer.observe(el);
    d.addEventListener('click',function(){
      var t=document.getElementById(d.dataset.target);
      if(t)t.scrollIntoView({behavior:'smooth'});
    });
  });
  dashes.forEach(function(d,i){
    d.style.transform='translateX(16px)';d.style.opacity='0';
    setTimeout(function(){d.style.transform='';d.style.opacity='1';},200+i*50);
  });
})();
</script>`;

/** Wrap title, theme CSS, TOC, and body HTML into a full document. */

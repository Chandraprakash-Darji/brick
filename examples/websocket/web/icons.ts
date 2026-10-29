// SVG bodies from @iconify-json/hugeicons, Hugeicons stroke icons.
export const icons = {
  "bubble-chat":
    '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M21.5 12a9.5 9.5 0 0 1-9.5 9.5c-1.628 0-3.16-.41-4.5-1.131c-1.868-1.007-3.125-.071-4.234.097a.53.53 0 0 1-.456-.156a.64.64 0 0 1-.117-.703c.436-1.025.835-2.969.29-4.607a9.5 9.5 0 0 1-.483-3a9.5 9.5 0 1 1 19 0"/><path d="M12.126 12H12m-3.876 0H8m8.125 0H16m-3.75 0a.25.25 0 1 1-.5 0a.25.25 0 0 1 .5 0m-4 0a.25.25 0 1 1-.5 0a.25.25 0 0 1 .5 0m8 0a.25.25 0 1 1-.5 0a.25.25 0 0 1 .5 0"/></g>',
  "arrow-up-02":
    '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 5.5V19m6-8s-4.419-6-6-6s-6 6-6 6"/>',
  "arrow-up-right-01":
    '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 6.65s6.938-.542 7.915.435S17.35 15 17.35 15m-.85-7.5l-10 10"/>',
  "logout-01":
    '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.5 8.04c-.041-1.16-.178-1.885-.636-2.453c-.653-.812-1.77-1.066-4.004-1.576l-1-.228c-3.395-.774-5.092-1.161-6.226-.27C2.5 4.405 2.5 6.126 2.5 9.568v4.864c0 3.442 0 5.164 1.134 6.055s2.83.504 6.225-.27l1.002-.228c2.233-.51 3.35-.764 4.003-1.576c.458-.567.595-1.293.636-2.453m3-6.948s3 2.21 3 3s-3 3-3 3m2.5-3H8.5"/>',
};

export function svgIcon(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${body}</svg>`;
}

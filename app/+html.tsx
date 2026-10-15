import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Expo Router only uses this document for web exports.
export default function RootHtml({ children }: PropsWithChildren) {
  const { headNodes, bodyNodes, htmlAttributes, bodyAttributes } = useServerDocumentContext();

  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="AJT" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
        <ScrollViewStyleReset />
        <script dangerouslySetInnerHTML={{ __html: iphonePwaScript }} />
        <style id="ajt-pwa" dangerouslySetInnerHTML={{ __html: safeAreaStyles }} />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}

// Run before the first paint. Neither regular Safari nor other platforms opt in.
const iphonePwaScript = `
if (/iPhone/.test(navigator.userAgent) &&
    (navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches)) {
  var appHtml = document.documentElement;
  appHtml.setAttribute('data-ajt-iphone-pwa', '');

  function fitAppHeight() {
    var root = document.getElementById('root');
    if (!root) return;
    // Try the CSS correction first, then the large viewport, then the visible height.
    appHtml.removeAttribute('data-ajt-height-fallback');
    appHtml.style.removeProperty('--app-height');
    if (Math.abs(root.getBoundingClientRect().bottom - window.innerHeight) <= 1) return;
    appHtml.setAttribute('data-ajt-height-fallback', 'lvh');
    if (Math.abs(root.getBoundingClientRect().bottom - window.innerHeight) <= 1) return;
    appHtml.setAttribute('data-ajt-height-fallback', 'screen');
    appHtml.style.setProperty('--app-height', window.innerHeight + 'px');
  }

  var heightFrame;
  function scheduleAppHeight() {
    cancelAnimationFrame(heightFrame);
    heightFrame = requestAnimationFrame(fitAppHeight);
  }
  document.addEventListener('DOMContentLoaded', fitAppHeight);
  window.addEventListener('resize', scheduleAppHeight);
  window.addEventListener('orientationchange', scheduleAppHeight);
}
`;

// Keep the existing browser layout. On installed iPhones, the root fills the
// visible area; the bottom inset belongs inside screens/the tab bar instead.
const safeAreaStyles = `
:root {
  --ajt-safe-area-top: env(safe-area-inset-top, 0px);
  --ajt-safe-area-right: env(safe-area-inset-right, 0px);
  --ajt-safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --ajt-safe-area-left: env(safe-area-inset-left, 0px);
}
html, body { overflow: hidden; }
body { margin: 0; }
#root {
  box-sizing: border-box;
  padding: var(--ajt-safe-area-top) var(--ajt-safe-area-right)
    var(--ajt-safe-area-bottom) var(--ajt-safe-area-left);
}
/* React Native web modals are fixed portals outside #root. */
body [aria-modal="true"] {
  top: var(--ajt-safe-area-top);
  right: var(--ajt-safe-area-right);
  bottom: var(--ajt-safe-area-bottom);
  left: var(--ajt-safe-area-left);
}
/* Compensate only once: body and #root inherit the visible height. */
html[data-ajt-iphone-pwa] {
  height: calc(100% + env(safe-area-inset-top, 0px));
  overflow: hidden;
}
html[data-ajt-iphone-pwa][data-ajt-height-fallback="lvh"] {
  height: 100lvh;
}
html[data-ajt-iphone-pwa][data-ajt-height-fallback="screen"] {
  height: var(--app-height);
}
html[data-ajt-iphone-pwa] body,
html[data-ajt-iphone-pwa] #root {
  height: 100%;
  overflow: hidden;
}
html[data-ajt-iphone-pwa] #root {
  padding-bottom: 0;
}
html[data-ajt-iphone-pwa] #ajt-tab-bar {
  padding-bottom: env(safe-area-inset-bottom, 0px) !important;
}
html[data-ajt-iphone-pwa] body [aria-modal="true"] {
  bottom: 0;
}
`;

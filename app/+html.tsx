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
        <meta name="theme-color" content="#03295B" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="AJT" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
        <ScrollViewStyleReset />
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

// Keep the navy background behind the system indicators. Reserve all four
// edges once, including landscape. The web provider prevents nested screens
// from adding the same insets again. Native apps retain their original provider.
const safeAreaStyles = `
:root {
  --ajt-safe-area-top: env(safe-area-inset-top, 0px);
  --ajt-safe-area-right: env(safe-area-inset-right, 0px);
  --ajt-safe-area-bottom: env(safe-area-inset-bottom, 0px);
  --ajt-safe-area-left: env(safe-area-inset-left, 0px);
  background-color: #03295B;
}
body { margin: 0; background-color: #03295B; }
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
`;

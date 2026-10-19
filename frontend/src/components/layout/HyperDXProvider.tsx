'use client';

import { useEffect } from 'react';

export function HyperDXProvider() {
  useEffect(() => {
    // Use the Next.js proxy route so the SDK always talks to the same origin.
    // This prevents mixed-content blocks when the app is served over HTTPS
    // (e.g. dev tunnels) while the OTel collector is plain HTTP internally.
    const collectorUrl = `${window.location.origin}/api/otlp`;

    // Trace propagation target: same host as the page (covers both localhost
    // and any tunnel URL automatically).
    const traceTarget = new RegExp(window.location.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    import('@hyperdx/browser').then(({ default: HyperDX }) => {
      HyperDX.init({
        apiKey:                 '',
        url:                    collectorUrl,
        service:                'retail-demo-frontend',
        tracePropagationTargets: [traceTarget],
        consoleCapture:         true,
        // advancedNetworkCapture instruments XHR/fetch requests, creating spans
        // that link frontend activity to server-side traces via tracePropagationTargets.
        advancedNetworkCapture: true,
        disableReplay:          false,
      });
    });
  }, []);

  return null;
}

import type { EntryContext, DataFunctionArgs } from '@remix-run/node';
import { RemixServer } from '@remix-run/react';
import { renderToString } from 'react-dom/server';
import * as Sentry from '@sentry/remix';

Sentry.init({
  dsn: 'https://public@dsn.ingest.sentry.io/1337',
  tracesSampleRate: 1,
  tracePropagationTargets: ['example.org'],
  // Disabling to test series of envelopes deterministically.
  autoSessionTracking: false,
});

export function handleError(error: unknown, { request }: DataFunctionArgs): void {
  if (error instanceof Error) {
    Sentry.captureRemixServerException(error, 'remix.server', request);
  } else {
    Sentry.captureException(error);
  }
}

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  let markup = renderToString(<RemixServer context={remixContext} url={request.url} />);

  responseHeaders.set('Content-Type', 'text/html');

  return new Response('<!DOCTYPE html>' + markup, {
    status: responseStatusCode,
    headers: responseHeaders,
  });
}

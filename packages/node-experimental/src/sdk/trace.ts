import type { Span as OtelSpan, Tracer } from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';
import { getCurrentHub, hasTracingEnabled, Transaction } from '@sentry/core';
import { _INTERNAL_getSentrySpan } from '@sentry/opentelemetry-node';
import type { Span, TransactionContext } from '@sentry/types';
import { isThenable } from '@sentry/utils';

import type { NodeExperimentalClient } from '../types';

/**
 * Wraps a function with a transaction/span and finishes the span after the function is done.
 * The created span is the active span and will be used as parent by other spans created inside the function
 * and can be accessed via `Sentry.getSpan()`, as long as the function is executed while the scope is active.
 *
 * If you want to create a span that is not set as active, use {@link startInactiveSpan}.
 *
 * Note that if you have not enabled tracing extensions via `addTracingExtensions`
 * or you didn't set `tracesSampleRate`, this function will not generate spans
 * and the `span` returned from the callback will be undefined.
 */
export function startSpan<T>(context: TransactionContext, callback: (span: Span | undefined) => T): T {
  const tracer = getTracer();
  if (!tracer) {
    return callback(undefined);
  }

  const name = context.name || context.description || context.op || '<unknown>';

  return tracer.startActiveSpan(name, (span: OtelSpan): T => {
    const otelSpanId = span.spanContext().spanId;

    const sentrySpan = _INTERNAL_getSentrySpan(otelSpanId);

    if (sentrySpan && isTransaction(sentrySpan) && context.metadata) {
      sentrySpan.setMetadata(context.metadata);
    }

    function finishSpan(): void {
      span.end();
    }

    let maybePromiseResult: T;
    try {
      maybePromiseResult = callback(sentrySpan);
    } catch (e) {
      sentrySpan && sentrySpan.setStatus('internal_error');
      finishSpan();
      throw e;
    }

    if (isThenable(maybePromiseResult)) {
      Promise.resolve(maybePromiseResult).then(
        () => {
          finishSpan();
        },
        () => {
          sentrySpan && sentrySpan.setStatus('internal_error');
          finishSpan();
        },
      );
    } else {
      finishSpan();
    }

    return maybePromiseResult;
  });
}

/**
 * @deprecated Use {@link startSpan} instead.
 */
export const startActiveSpan = startSpan;

/**
 * Creates a span. This span is not set as active, so will not get automatic instrumentation spans
 * as children or be able to be accessed via `Sentry.getSpan()`.
 *
 * If you want to create a span that is set as active, use {@link startSpan}.
 *
 * Note that if you have not enabled tracing extensions via `addTracingExtensions`
 * or you didn't set `tracesSampleRate` or `tracesSampler`, this function will not generate spans
 * and the `span` returned from the callback will be undefined.
 */
export function startInactiveSpan(context: TransactionContext): Span | undefined {
  const tracer = getTracer();
  if (!tracer) {
    return undefined;
  }

  const name = context.name || context.description || context.op || '<unknown>';
  const otelSpan = tracer.startSpan(name);

  const otelSpanId = otelSpan.spanContext().spanId;

  const sentrySpan = _INTERNAL_getSentrySpan(otelSpanId);

  if (!sentrySpan) {
    return undefined;
  }

  if (isTransaction(sentrySpan) && context.metadata) {
    sentrySpan.setMetadata(context.metadata);
  }

  // Monkey-patch `finish()` to finish the OTEL span instead
  // This will also in turn finish the Sentry Span, so no need to call this ourselves
  const wrappedSentrySpan = new Proxy(sentrySpan, {
    get(target, prop, receiver) {
      if (prop === 'finish') {
        return () => {
          otelSpan.end();
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  return wrappedSentrySpan;
}

/**
 * Returns the currently active span.
 */
export function getActiveSpan(): Span | undefined {
  const otelSpan = trace.getActiveSpan();
  const spanId = otelSpan && otelSpan.spanContext().spanId;
  return spanId ? _INTERNAL_getSentrySpan(spanId) : undefined;
}

function getTracer(): Tracer | undefined {
  if (!hasTracingEnabled()) {
    return undefined;
  }

  const client = getCurrentHub().getClient<NodeExperimentalClient>();
  return client && client.tracer;
}

function isTransaction(span: Span): span is Transaction {
  return span instanceof Transaction;
}

export type AlertSeverity = "info" | "warning" | "critical";

export type Alert = {
  severity: AlertSeverity;
  title: string;
  message: string;
  context?: Record<string, unknown>;
  createdAt: string;
};

export type AlertSink = {
  notify(alert: Alert): Promise<void>;
};

export class ConsoleAlertSink implements AlertSink {
  async notify(alert: Alert) {
    console.log(JSON.stringify({ event: "alert", ...alert }));
  }
}

export class WebhookAlertSink implements AlertSink {
  constructor(private readonly webhookUrl: string) {}

  async notify(alert: Alert) {
    try {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(alert),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`Alert webhook returned ${response.status}`);
      }
    } catch (error) {
      console.error(JSON.stringify({ event: "alert_delivery_failed", error: serializeError(error), alert }));
    }
  }
}

export class CompositeAlertSink implements AlertSink {
  constructor(private readonly sinks: AlertSink[]) {}

  async notify(alert: Alert) {
    for (const sink of this.sinks) {
      await sink.notify(alert);
    }
  }
}

export function createAlertSink(webhookUrl?: string): AlertSink {
  if (webhookUrl) {
    return new CompositeAlertSink([new ConsoleAlertSink(), new WebhookAlertSink(webhookUrl)]);
  }

  return new ConsoleAlertSink();
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }

  return { message: String(error) };
}

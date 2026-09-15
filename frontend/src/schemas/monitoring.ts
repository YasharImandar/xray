import { z } from 'zod';

export const ExtensionMonitorSnapshotSchema = z
  .object({
    found: z.boolean(),
    accessLogEnabled: z.boolean().optional(),
    accessLogPath: z.string().optional(),
    inbound: z
      .object({
        id: z.number(),
        remark: z.string(),
        tag: z.string().optional(),
        protocol: z.string().optional(),
        port: z.number(),
        enable: z.boolean().optional(),
        up: z.number().optional(),
        down: z.number().optional(),
        clients: z.number().optional(),
      })
      .loose()
      .nullable()
      .optional(),
    logs: z.array(
      z
        .object({
          raw: z.string(),
          user: z.string().optional(),
          email: z.string().optional(),
          clientIp: z.string().optional(),
          country: z.string().optional(),
          countryCode: z.string().optional(),
          url: z.string().optional(),
        })
        .loose(),
    ),
    clients: z.array(
      z
        .object({
          email: z.string(),
          user: z.string().optional(),
          clientIp: z.string().optional(),
          country: z.string().optional(),
          countryCode: z.string().optional(),
          online: z.boolean().optional(),
          lastDest: z.string().optional(),
          lastURL: z.string().optional(),
          recentDests: z.array(z.string()).optional(),
          hits: z.number().optional(),
          rejected: z.number().optional(),
        })
        .loose(),
    ),
    topDests: z
      .array(
        z
          .object({
            host: z.string(),
            port: z.string().optional(),
            url: z.string().optional(),
            hits: z.number().optional(),
            clients: z.number().optional(),
            rejected: z.number().optional(),
            lastSeen: z.number().optional(),
          })
          .loose(),
      )
      .optional(),
    countries: z
      .array(
        z
          .object({
            code: z.string(),
            name: z.string().optional(),
            clients: z.number().optional(),
            hits: z.number().optional(),
          })
          .loose(),
      )
      .optional(),
    timeline: z
      .array(
        z
          .object({
            at: z.number(),
            events: z.number().optional(),
            rejected: z.number().optional(),
          })
          .loose(),
      )
      .optional(),
    stats: z
      .object({
        eventCount: z.number().optional(),
        uniqueDests: z.number().optional(),
        uniqueIps: z.number().optional(),
        logCount: z.number().optional(),
        online: z.number().optional(),
        accepted: z.number().optional(),
        rejected: z.number().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

export type ExtensionMonitorSnapshot = z.infer<typeof ExtensionMonitorSnapshotSchema>;
export type ExtensionLogEntry = ExtensionMonitorSnapshot['logs'][number];
export type ExtensionClientRow = ExtensionMonitorSnapshot['clients'][number];
export type ExtensionDestRow = NonNullable<ExtensionMonitorSnapshot['topDests']>[number];
export type ExtensionCountryRow = NonNullable<ExtensionMonitorSnapshot['countries']>[number];
export type ExtensionBucket = NonNullable<ExtensionMonitorSnapshot['timeline']>[number];

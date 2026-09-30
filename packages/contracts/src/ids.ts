import { z } from 'zod';

/** A tool is always named `<source>.<name>`, so the same name on two sources is never the same tool. */
export const ToolId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*\.[a-z][a-zA-Z0-9]*$/, 'tool ids look like source.name, for example npm.packument');
/** A tool id such as `npm.packument`. */
export type ToolId = z.infer<typeof ToolId>;

/** An agent id such as `diff-judge`. */
export const AgentId = z.string().regex(/^[a-z][a-z0-9-]*$/, 'agent ids are lowercase words joined by dashes');
/** An agent id such as `diff-judge`. */
export type AgentId = z.infer<typeof AgentId>;

/**
 * Plugin options.
 */
export interface ShtmlOptions {
  /**
   * Directory to resolve includes and virtual paths from,
   * relative to Vite's root.  Defaults to `"src"`.
   */
  includeDir?: string;

  /**
   * Extra variables exposed to `<!--#echo var="..." -->`.
   */
  variables?: Record<string, string>;

  /**
   * Whether to allow `<!--#exec cmd="..." -->`.
   * Defaults to `false` for security.
   */
  allowExec?: boolean;
}

/**
 * Config state that flows through the SSI processing pipeline.
 */
export interface SsiConfig {
  timefmt: string;
  sizefmt: string;
  errmsg: string;
}

export interface DiagnosticReport {
  generatedAt: string;
  appVersion: string;
  host: "electron" | "web";
  platform: string;
  runtime: Record<string, string>;
  database: "ok";
  novelCount: number;
}

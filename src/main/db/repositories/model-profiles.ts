import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import type {
  ModelProfile,
  SaveModelProfileInput,
} from "@domain/model-profile";
import type { DbRow } from "./shared";

function profileFrom(row: DbRow): ModelProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    provider: row.provider as ModelProfile["provider"],
    modelId: String(row.model_id),
    baseUrl: String(row.base_url),
    contextWindow: Number(row.context_window),
    inputPricePerMillion:
      row.input_price === null ? null : Number(row.input_price),
    outputPricePerMillion:
      row.output_price === null ? null : Number(row.output_price),
    isDefault: Boolean(row.is_default),
    hasSecret: Boolean(row.has_secret),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createModelProfilesRepository(client: Client) {
  async function listModelProfiles(): Promise<ModelProfile[]> {
    const result = await client.execute(
      "SELECT * FROM model_profiles ORDER BY is_default DESC, updated_at DESC",
    );
    return result.rows.map((row) => profileFrom(row as DbRow));
  }

  async function getModelProfile(id: string): Promise<ModelProfile | null> {
    const result = await client.execute({
      sql: "SELECT * FROM model_profiles WHERE id=?",
      args: [id],
    });
    return result.rows[0] ? profileFrom(result.rows[0] as DbRow) : null;
  }

  async function saveModelProfile(
    input: SaveModelProfileInput,
    hasSecret: boolean,
  ): Promise<ModelProfile> {
    const id = input.id ?? nanoid(),
      now = new Date().toISOString();
    if (input.isDefault)
      await client.execute("UPDATE model_profiles SET is_default=0");
    await client.execute({
      sql: `INSERT INTO model_profiles VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,provider=excluded.provider,model_id=excluded.model_id,base_url=excluded.base_url,context_window=excluded.context_window,input_price=excluded.input_price,output_price=excluded.output_price,is_default=excluded.is_default,has_secret=excluded.has_secret,updated_at=excluded.updated_at`,
      args: [
        id,
        input.name.trim(),
        input.provider,
        input.modelId.trim(),
        input.baseUrl.trim(),
        input.contextWindow,
        input.inputPricePerMillion,
        input.outputPricePerMillion,
        input.isDefault ? 1 : 0,
        hasSecret ? 1 : 0,
        now,
        now,
      ],
    });
    return (await getModelProfile(id))!;
  }

  async function deleteModelProfile(id: string): Promise<void> {
    await client.execute({
      sql: "DELETE FROM model_profiles WHERE id=?",
      args: [id],
    });
  }

  return {
    listModelProfiles,
    getModelProfile,
    saveModelProfile,
    deleteModelProfile,
  };
}

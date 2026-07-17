import { Resend } from "resend";
import { loadNamedEnv, requireEnv } from "../src/env.mjs";
const env = await loadNamedEnv(["RESEND_API_KEY"]);
const resend = new Resend(requireEnv(env, "RESEND_API_KEY"));
const broadcasts = await resend.broadcasts.list();
if (broadcasts.error) throw new Error(broadcasts.error.message);
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), broadcasts: broadcasts.data?.data ?? [] }, null, 2));

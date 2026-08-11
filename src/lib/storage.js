import { supabase } from "./supabaseClient";

async function getCurrentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

// Mirrors the old window.storage.get(key) shape: resolves { value: <jsonString> } or null.
export async function getItem(key) {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const { data, error } = await supabase
    .from("vocab_kv")
    .select("value")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  return { value: JSON.stringify(data.value) };
}

// Mirrors the old window.storage.set(key, jsonString) call.
export async function setItem(key, valueString) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("로그인이 필요해요");
  let parsed;
  try {
    parsed = JSON.parse(valueString);
  } catch {
    parsed = valueString;
  }
  const { error } = await supabase
    .from("vocab_kv")
    .upsert(
      { user_id: userId, key, value: parsed, updated_at: new Date().toISOString() },
      { onConflict: "user_id,key" }
    );
  if (error) throw error;
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";

type ActionState = {
  error?: string;
};

export async function signUp(
  _previousState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const mode = String(formData.get("mode") ?? "create");

  if (!email || password.length < 8) {
    return { error: "Use a valid email and a password of at least 8 characters." };
  }

  let fullName = "";
  let joinCode = "";

  if (mode === "join") {
    fullName = String(formData.get("full_name") ?? "").trim();
    joinCode = String(formData.get("join_code") ?? "").trim();

    if (!fullName || !joinCode) {
      return { error: "Enter your name and a join code to join an existing firm." };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password
  });

  if (error) {
    return { error: error.message };
  }

  if (mode === "join") {
    const { error: redeemError } = await supabase.rpc("redeem_join_code", {
      p_code: joinCode,
      p_full_name: fullName
    });

    if (redeemError) {
      return { error: redeemError.message };
    }

    revalidatePath("/dashboard");
    redirect("/dashboard");
  }

  redirect("/onboarding");
}

export async function login(
  _previousState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createFirm(
  _previousState: ActionState,
  formData: FormData
): Promise<ActionState> {
  console.log("[onboarding] createFirm:start");
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError) {
    console.error("[onboarding] createFirm:auth-error", userError);
    return { error: userError.message };
  }

  if (!user) {
    console.error("[onboarding] createFirm:no-user");
    return { error: "You need to be signed in before creating a firm." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const mlrSupervisor = String(formData.get("mlr_supervisor") ?? "").trim();
  const firmReferenceNumber = String(
    formData.get("firm_reference_number") ?? ""
  ).trim();
  const brandPrimary = String(formData.get("brand_primary") ?? "#0f766e");

  if (!name || !fullName) {
    console.error("[onboarding] createFirm:validation-error", {
      hasName: Boolean(name),
      hasFullName: Boolean(fullName)
    });
    return { error: "Firm name and your name are required." };
  }

  const slug = slugify(name);

  console.log("[onboarding] createFirm:rpc-start", {
    userId: user.id,
    slug
  });

  const { data: firmId, error: rpcError } = await supabase.rpc(
    "create_firm_with_admin",
    {
      p_user_id: user.id,
      p_full_name: fullName,
      p_firm_name: name,
      p_slug: slug,
      p_mlr_supervisor: mlrSupervisor || null,
      p_firm_reference_number: firmReferenceNumber || null,
      p_brand_primary: brandPrimary
    }
  );

  if (rpcError) {
    console.error("[onboarding] createFirm:rpc-error", rpcError);
    return { error: rpcError.message };
  }

  console.log("[onboarding] createFirm:firm-inserted", { firmId });
  console.log("[onboarding] createFirm:member-inserted", { firmId });
  console.log("[onboarding] createFirm:audit-event-inserted", { firmId });

  if (!firmId) {
    console.error("[onboarding] createFirm:missing-rpc-result");
    return {
      error: "The firm was not created. Please try again or check the server logs."
    };
  }

  console.log("[onboarding] createFirm:complete", {
    firmId
  });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

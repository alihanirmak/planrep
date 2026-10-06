import { NextResponse } from "next/server";
import { getSsoConfig } from "@/lib/sso/config";

// Login sayfasinin SSO butonunu gosterip gostermeyecegini belirlemek
// icin: SSO yapilandirilmamissa (OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET
// tanimli degilse) enabled=false doner, buton hic render edilmez.
export async function GET() {
  const config = getSsoConfig();
  if (!config) return NextResponse.json({ enabled: false });
  return NextResponse.json({ enabled: true, providerLabel: config.providerLabel });
}

import { createHash,randomBytes,randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { requireIFSession } from "@/lib/infinite-flight/server";

export const runtime="nodejs";
const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateCode(){
  let code="";
  while(code.length<10) for(const byte of randomBytes(16)){
    if(byte<224&&code.length<10) code+=alphabet[byte%alphabet.length];
  }
  return code;
}

/**
 * One-time bootstrap for the explicitly configured first administrator.
 * The database marker and code insert happen in one atomic statement, so
 * concurrent requests cannot mint multiple bootstrap codes.
 */
export async function POST(){
  try{
    const {identity}=await requireIFSession();
    const initialAdminId=process.env.IF_INITIAL_ADMIN_USER_ID?.trim();
    if(!initialAdminId||identity.id!==initialAdminId){
      return NextResponse.json({error:"This Infinite Flight account is not configured for first-admin setup."},{status:403});
    }

    const code=generateCode();
    const id=randomUUID();
    const hash=createHash("sha256").update(code).digest("hex");
    const sql=neon(process.env.DATABASE_URL!);
    const rows=await sql`
      WITH bootstrap AS (
        INSERT INTO public.app_settings (key,value,updated_at)
        VALUES ('initial_admin_bootstrap_used',jsonb_build_object('ifcUserId',${identity.id}::text,'usedAt',now()),now())
        ON CONFLICT (key) DO NOTHING
        RETURNING key
      ),
      issued AS (
        INSERT INTO public.application_codes
          (id,code_hash,issued_to_ifc_user_id,created_by_ifc_user_id,expires_at,created_at)
        SELECT ${id},${hash},${identity.id},${identity.id},now()+interval '30 minutes',now()
        FROM bootstrap
        RETURNING id
      )
      SELECT id FROM issued
    `;
    if(!rows.length){
      return NextResponse.json({error:"The first-admin bootstrap has already been used. Ask an existing organisation administrator to issue another code."},{status:409});
    }
    return NextResponse.json({code,expiresInMinutes:30},{status:201,headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Could not create the first-admin code."},{status:Number((error as {status?:number})?.status)||500});
  }
}

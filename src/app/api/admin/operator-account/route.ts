import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { adminOperatorCredentials } from "@/lib/db/schema";
import { requireIFSession,requireOrganizationAdmin } from "@/lib/infinite-flight/server";
import { sealSecret } from "@/lib/security/secret-box";
export const runtime="nodejs";
const OPERATOR_COOKIE="vb_admin_operator_ref";
const operatorCookieOptions={httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax" as const,path:"/",maxAge:60*60*24*30};
export async function GET(){try{const {session,identity}=await requireIFSession();await requireOrganizationAdmin(session);const [row]=await getDb().select({connectedAt:adminOperatorCredentials.connectedAt}).from(adminOperatorCredentials).where(eq(adminOperatorCredentials.ifcUserId,identity.id)).limit(1);const response=NextResponse.json({connected:Boolean(row),connectedAt:row?.connectedAt??null},{headers:{"Cache-Control":"no-store"}});if(row)response.cookies.set(OPERATOR_COOKIE,identity.id,operatorCookieOptions);else response.cookies.set(OPERATOR_COOKIE,"",{...operatorCookieOptions,maxAge:0});return response}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to read admin connection."},{status:Number((error as {status?:number})?.status)||500})}}
export async function POST(){try{const {session,identity}=await requireIFSession();await requireOrganizationAdmin(session);const encryptedSession=sealSecret(JSON.stringify(session));await getDb().insert(adminOperatorCredentials).values({ifcUserId:identity.id,encryptedSession}).onConflictDoUpdate({target:adminOperatorCredentials.ifcUserId,set:{encryptedSession,updatedAt:new Date()}});const response=NextResponse.json({success:true,connected:true},{headers:{"Cache-Control":"no-store"}});response.cookies.set(OPERATOR_COOKIE,identity.id,operatorCookieOptions);return response}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to connect admin account."},{status:Number((error as {status?:number})?.status)||500})}}

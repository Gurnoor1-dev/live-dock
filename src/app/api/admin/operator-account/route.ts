import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { adminOperatorCredentials } from "@/lib/db/schema";
import { requireIFSession,requireOrganizationAdmin } from "@/lib/infinite-flight/server";
import { sealSecret } from "@/lib/security/secret-box";
export const runtime="nodejs";
export async function GET(){try{const {session,identity}=await requireIFSession();await requireOrganizationAdmin(session);const [row]=await getDb().select({connectedAt:adminOperatorCredentials.connectedAt}).from(adminOperatorCredentials).where(eq(adminOperatorCredentials.ifcUserId,identity.id)).limit(1);return NextResponse.json({connected:Boolean(row),connectedAt:row?.connectedAt??null})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to read admin connection."},{status:Number((error as {status?:number})?.status)||500})}}
export async function POST(){try{const {session,identity}=await requireIFSession();await requireOrganizationAdmin(session);const encryptedSession=sealSecret(JSON.stringify(session));await getDb().insert(adminOperatorCredentials).values({ifcUserId:identity.id,encryptedSession}).onConflictDoUpdate({target:adminOperatorCredentials.ifcUserId,set:{encryptedSession,updatedAt:new Date()}});return NextResponse.json({success:true,connected:true})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to connect admin account."},{status:Number((error as {status?:number})?.status)||500})}}

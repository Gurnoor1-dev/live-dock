import { NextRequest,NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
import { requireIFSession } from "@/lib/infinite-flight/server";
export const runtime="nodejs";
export async function GET(){
 try{
  const {session,identity}=await requireIFSession();
  const db=getDb();
  const username=identity.username||null;
  await db.insert(appUsers).values({ifcUserId:identity.id,ifcUsername:username}).onConflictDoUpdate({target:appUsers.ifcUserId,set:{ifcUsername:username,updatedAt:new Date()}});
  const [user]=await db.select().from(appUsers).where(eq(appUsers.ifcUserId,identity.id)).limit(1);
  return NextResponse.json({ifcUserId:identity.id,username,role:null,onboardingRequired:!user?.onboardingCompletedAt,discordUserId:user?.discordUserId??null,discordUsername:user?.discordUsername??null},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to load profile."},{status:Number((error as {status?:number})?.status)||500})}
}
export async function PATCH(request:NextRequest){
 try{const {identity}=await requireIFSession();const body=await request.json().catch(()=>({})) as {discordUserId?:string;discordUsername?:string};const id=String(body.discordUserId||"").trim();if(!/^\d{17,20}$/.test(id))return NextResponse.json({error:"Discord User ID must contain 17–20 digits."},{status:400});const db=getDb();const duplicate=await db.select({ifcUserId:appUsers.ifcUserId}).from(appUsers).where(eq(appUsers.discordUserId,id)).limit(1);if(duplicate.length&&duplicate[0].ifcUserId!==identity.id)return NextResponse.json({error:"This Discord account is already linked to another pilot."},{status:409});await db.update(appUsers).set({discordUserId:id,discordUsername:String(body.discordUsername||"").trim()||null,updatedAt:new Date()}).where(eq(appUsers.ifcUserId,identity.id));return NextResponse.json({success:true})}
 catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to update profile."},{status:Number((error as {status?:number})?.status)||500})}
}

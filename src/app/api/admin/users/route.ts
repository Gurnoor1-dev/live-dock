import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { appUsers } from "@/lib/db/schema";
import { ifFetch,ORGANIZATION_ID,requireIFSession,requireOrganizationAdmin } from "@/lib/infinite-flight/server";
type Member={userId:string;username:string|null;role:number;joinedAt:string;activeLifts:number};
export const runtime="nodejs";
export async function GET(){try{const {session}=await requireIFSession();await requireOrganizationAdmin(session);const [raw,users]=await Promise.all([ifFetch<Member[]|{items?:Member[]}>(`/live/organizations/${ORGANIZATION_ID}/members`,session),getDb().select().from(appUsers)]);const members=Array.isArray(raw)?raw:raw.items||[];const registry=new Map(users.map(u=>[u.ifcUserId,u]));const registered=members.filter(m=>Boolean(registry.get(m.userId)?.onboardingCompletedAt)).map(m=>({...m,appUser:registry.get(m.userId)}));const pending=members.filter(m=>!registry.get(m.userId)?.onboardingCompletedAt).map(m=>({...m,hasLoggedIn:registry.has(m.userId)}));return NextResponse.json({registered,pending})}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Unable to load members."},{status:Number((error as {status?:number})?.status)||500})}}

import { NextRequest,NextResponse } from "next/server";
import { requireIFSession,requireOrganizationAdmin } from "@/lib/infinite-flight/server";
import { runAutoCrew,runScheduleReviser } from "@/lib/automation/worker";

export const runtime="nodejs";
export const maxDuration=60;

export async function POST(request:NextRequest){
 try{
  const {session}=await requireIFSession();
  await requireOrganizationAdmin(session);
  const body=await request.json().catch(()=>({})) as {automation?:string};
  if(body.automation!=="auto-crew"&&body.automation!=="schedule-reviser"){
   return NextResponse.json({error:"Choose Auto Crew or Schedule Reviser."},{status:400});
  }
  const result=body.automation==="auto-crew"?await runAutoCrew():await runScheduleReviser();
  return NextResponse.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  const status=Number((error as {status?:number})?.status)||500;
  return NextResponse.json({error:error instanceof Error?error.message:"Unable to run automation."},{status,headers:{"Cache-Control":"no-store"}});
 }
}

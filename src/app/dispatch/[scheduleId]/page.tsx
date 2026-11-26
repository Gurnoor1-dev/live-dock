import { DispatchExperience } from "@/components/dispatch/dispatch-experience";
export default async function DispatchPage({params}:{params:Promise<{scheduleId:string}>}){
 const {scheduleId}=await params;
 return <DispatchExperience scheduleId={scheduleId}/>;
}
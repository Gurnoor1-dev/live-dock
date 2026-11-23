import "server-only";
import { getIFSession,type IFSession } from "@/lib/infinite-flight/session";
export const ORGANIZATION_ID="d50dcc80-8dac-4608-970c-61d6a4739488";
type Discovery={issuer?:string;userinfo_endpoint:string};
type Identity={id:string;username:string|null;displayName:string|null};
let discovery:Discovery|null=null;
const rateLimits=new Map<string,{isPro:boolean;remaining:number;updatedAt:number}>();
export function getIFRateLimit(session:IFSession){const value=rateLimits.get(session.accessToken);if(!value)return{isPro:false,remaining:4};if(Date.now()-value.updatedAt>60_000)return{isPro:value.isPro,remaining:value.isPro?19:4};return value;}
async function getDiscovery(){if(discovery)return discovery;let response:Response;try{response=await fetch("https://auth.infiniteflight.com/.well-known/openid-configuration",{headers:{Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(10_000)});}catch(error){throw new Error("Could not reach Infinite Flight OpenID discovery. Check the auth.infiniteflight.com issuer and retry. "+(error instanceof Error?error.message:"Network request failed."));}if(!response.ok)throw new Error(`Infinite Flight OpenID discovery returned HTTP ${response.status}.`);const value=await response.json() as Discovery;if(value.issuer&&value.issuer.replace(/\\/$/,"")!=="https://auth.infiniteflight.com")throw new Error("Infinite Flight returned unexpected OpenID issuer metadata.");if(!value.userinfo_endpoint||!value.userinfo_endpoint.startsWith("https://"))throw new Error("Infinite Flight did not publish a valid HTTPS user-info endpoint.");discovery=value;return value;}
export async function getIFIdentity(session:IFSession):Promise<Identity>{
 const config=await getDiscovery();const response=await fetch(config.userinfo_endpoint,{headers:{Authorization:"Bearer "+session.accessToken},cache:"no-store"});if(!response.ok)throw new Error("Infinite Flight could not verify the signed-in account.");const value=await response.json() as {sub?:string;preferred_username?:string;nickname?:string;name?:string};
 if(!value.sub||!/^[0-9a-f-]{36}$/i.test(value.sub))throw new Error("Infinite Flight returned an invalid account identifier.");
 return{id:value.sub,username:value.preferred_username||value.nickname||null,displayName:value.name||null};
}
export async function requireIFSession(){const session=await getIFSession();if(!session)throw Object.assign(new Error("Sign in with Infinite Flight to continue."),{status:401});return{session,identity:await getIFIdentity(session)};}
export async function ifFetch<T=unknown>(path:string,session:IFSession,init:RequestInit={}):Promise<T>{
 const response=await fetch("https://api.infiniteflight.com/public/v3"+path,{...init,headers:{Authorization:"Bearer "+session.accessToken,...(init.body?{"Content-Type":"application/json"}:{}),...(init.headers||{})},cache:"no-store"});
 const remainingHeader=response.headers.get("x-rate-limit-remaining");const remaining=remainingHeader===null?4:Number(remainingHeader);rateLimits.set(session.accessToken,{isPro:(response.headers.get("x-user-pro")||"").toLowerCase()==="true",remaining:Number.isFinite(remaining)?remaining:4,updatedAt:Date.now()});
 const payload=await response.json().catch(()=>({})) as {errorCode?:number;message?:string;result?:T};
 if(!response.ok||typeof payload.errorCode==="number"&&payload.errorCode!==0)throw Object.assign(new Error(payload.message||"Infinite Flight API request failed ("+response.status+")."),{status:response.status});
 return payload.result as T;
}
export async function requireOrganizationAdmin(session:IFSession){const org=await ifFetch<{role:number}>(`/live/organizations/${ORGANIZATION_ID}`,session);if(org.role!==1&&org.role!==2)throw Object.assign(new Error("Organisation administrator access is required."),{status:403});return org;}

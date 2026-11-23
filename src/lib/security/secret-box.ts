import "server-only";
import { createCipheriv,createDecipheriv,randomBytes } from "node:crypto";
function key(){const value=Buffer.from(process.env.ADMIN_CREDENTIALS_SECRET||"","base64");if(value.length!==32)throw new Error("ADMIN_CREDENTIALS_SECRET must be a base64-encoded 32-byte key.");return value;}
export function sealSecret(value:string){const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",key(),iv);const encrypted=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64url");}
export function openSecret(value:string){const packed=Buffer.from(value,"base64url");if(packed.length<29)throw new Error("Encrypted secret is invalid.");const decipher=createDecipheriv("aes-256-gcm",key(),packed.subarray(0,12));decipher.setAuthTag(packed.subarray(12,28));return Buffer.concat([decipher.update(packed.subarray(28)),decipher.final()]).toString("utf8");}

import fs from "node:fs";
import path from "node:path";

const root=path.resolve("src/assets/aircrafts");
const output=path.resolve("src/lib/aircraft-images.generated.ts");
fs.mkdirSync(root,{recursive:true});
const imports=[];
const entries=[];
for(const registration of fs.readdirSync(root,{withFileTypes:true}).filter(item=>item.isDirectory())){
  const folder=path.join(root,registration.name);
  const files=fs.readdirSync(folder).filter(name=>/\.png$/i.test(name)).sort();
  if(!files.length)continue;
  const selected=files[0];
  const relative=path.relative(path.dirname(output),path.join(folder,selected)).split(path.sep).join("/");
  const variable="aircraftImage"+imports.length;
  imports.push("import "+variable+" from "+JSON.stringify("./"+relative)+";");
  entries.push(JSON.stringify(registration.name.toUpperCase())+": "+variable+".src");
}
const source=imports.join("\n")+(imports.length?"\n\n":"")+"export const aircraftImages: Record<string,string> = {"+entries.join(",")+"};\n";
fs.writeFileSync(output,source);
console.log("Generated aircraft image registry for "+entries.length+" registrations.");

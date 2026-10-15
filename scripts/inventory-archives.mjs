#!/usr/bin/env node
/** Read-only ZIP metadata inventory. Source text travels over pipes only; it is never extracted. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, "packages/modules/ai/package.json"));
const ts = require("typescript");
const literal = n => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
const safeName = value => typeof value === "string" && /^[\p{L}\p{N}_-]{1,40}$/u.test(value) ? value : null;
function chain(expression, helpers = new Map()) {
  const parts = [];
  while (expression) {
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
      parts.push({ method: expression.expression.name.text, args: expression.arguments });
      expression = expression.expression.expression;
    } else if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && helpers.has(expression.expression.text)) {
      return {constructor:"SlashCommandBuilder",parts:[...parts,{method:"setName",args:[expression.arguments[helpers.get(expression.expression.text)]]}]};
    } else if (ts.isNewExpression(expression)) {
      return { constructor: expression.expression.getText(), parts };
    } else break;
  }
  return { constructor: null, parts };
}
function callbackContext(node) {
  for (let cursor = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isArrowFunction(cursor) || ts.isFunctionExpression(cursor)) {
      const parent = cursor.parent;
      if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)) return parent.expression.name.text;
      return null;
    }
  }
  return null;
}
function rootCommand(node, helpers = new Map()) {
  for (let cursor = node; cursor; cursor = cursor.parent) {
    if (!ts.isCallExpression(cursor)) continue;
    const builder = chain(cursor, helpers);
    if (builder.constructor?.endsWith("SlashCommandBuilder") || builder.constructor?.endsWith("ContextMenuCommandBuilder")) {
      const name = builder.parts.find(p => p.method === "setName");
      if (name) return safeName(literal(name.args[0]));
    }
  }
  return null;
}
export function analyzeJavaScript(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.TS);
  const helpers=new Map();
  function findHelpers(node) {
    if(ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)) {
      const builder=chain(node.initializer.body);
      const argument=builder.parts.find(part=>part.method==="setName")?.args[0];
      if(builder.constructor?.endsWith("SlashCommandBuilder") && argument && ts.isIdentifier(argument)) {
        const index=node.initializer.parameters.findIndex(parameter=>parameter.name.getText(source)===argument.text);
        if(index>=0)helpers.set(node.name.text,index);
      }
    }
    ts.forEachChild(node,findHelpers);
  }
  findHelpers(source);
  function staticNames(expression) {
    const direct=safeName(literal(expression));
    if(direct)return [direct];
    if(expression && ts.isTemplateExpression(expression) && expression.templateSpans.length===1) {
      const span=expression.templateSpans[0];
      if(ts.isIdentifier(span.expression))for(let cursor=expression.parent;cursor;cursor=cursor.parent) {
        if(!ts.isArrowFunction(cursor) || cursor.parameters[0]?.name.getText(source)!==span.expression.text)continue;
        const call=cursor.parent;
        if(ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text==="map" && ts.isArrayLiteralExpression(call.expression.expression)) {
          return call.expression.expression.elements.map(item=>safeName(expression.head.text+(literal(item)??"")+span.literal.text)).filter(Boolean).slice(0,32);
        }
      }
    }
    return [];
  }
  function chainedArgument(call, method) {
    for (let cursor=call;cursor;) {
      const member=cursor.parent;
      const invocation=member?.parent;
      if (!member || !ts.isPropertyAccessExpression(member) || member.expression!==cursor
        || !invocation || !ts.isCallExpression(invocation) || invocation.expression!==member) break;
      if (member.name.text===method) return invocation.arguments[0];
      cursor=invocation;
    }
    return null;
  }
  const symbols = [];
  let optionsExcluded = 0, unclassifiedSetNames = 0;
  const property = (object,key) => object.properties.find(p=>ts.isPropertyAssignment(p) && (p.name.getText(source)===key || literal(p.name)===key));
  function rawCommandObject(object,kind,parentCommand=null) {
    const nameProperty=property(object,"name");
    if(!nameProperty)return;
    const name=safeName(literal(nameProperty.initializer));
    symbols.push({kind,name,parent_command:parentCommand,line:source.getLineAndCharacterOfPosition(nameProperty.getStart(source)).line+1,
      declaration:null,description:literal(property(object,"description")?.initializer),
      detection:"typescript-ast-command-data-object",resolution:name?"literal":"dynamic-name-unresolved"});
    const options=property(object,"options")?.initializer;
    if(options && ts.isArrayLiteralExpression(options))for(const option of options.elements) {
      if(!ts.isObjectLiteralExpression(option))continue;
      const type=property(option,"type")?.initializer;
      const number=type && ts.isNumericLiteral(type)?Number(type.text):null;
      if(number===1 || number===2)rawCommandObject(option,number===1?"subcommand":"subcommand-group",parentCommand??name);
      else optionsExcluded++;
    }
  }
  function visit(node) {
    if(ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && /(?:^|[\\/])(?:assets?|public|images?)[\\/].+\.(?:png|jpe?g|webp|gif|svg|mp3|ogg|wav|woff2?)$/iu.test(node.moduleSpecifier.text)) {
      symbols.push({kind:"asset flow",name:node.moduleSpecifier.text,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,declaration:"import",detection:"typescript-ast-asset-import",resolution:"literal"});
    }
    if(ts.isCallExpression(node) && ts.isIdentifier(node.expression) && helpers.has(node.expression.text)) {
      const names=staticNames(node.arguments[helpers.get(node.expression.text)]);
      for(const name of names)symbols.push({kind:"slash-command",name,parent_command:null,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,declaration:node.expression.text,description:null,detection:"typescript-ast-builder-helper-static-argument",resolution:"literal"});
    }
    if(ts.isPropertyAssignment(node) && (node.name.getText(source)==="data" || literal(node.name)==="data") && ts.isObjectLiteralExpression(node.initializer) && property(node.initializer,"description") && property(node.initializer,"name"))rawCommandObject(node.initializer,"slash-command");
    if(ts.isStringLiteral(node) && /(?:^|[\\/])(?:assets?|public|images?)[\\/].+\.(?:png|jpe?g|webp|gif|svg|mp3|ogg|wav|woff2?)$/iu.test(node.text)) {
      symbols.push({kind:"asset flow",name:node.text,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,declaration:"string-literal-reference",detection:"typescript-ast-asset-reference",resolution:"literal"});
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "setName") {
      const builder = chain(node,helpers);
      const context = callbackContext(node);
      let kind = builder.constructor?.endsWith("SlashCommandBuilder") ? "slash-command"
        : builder.constructor?.endsWith("ContextMenuCommandBuilder") ? "context-command"
        : context === "addSubcommand" ? "subcommand"
        : context === "addSubcommandGroup" ? "subcommand-group" : null;
      if (/^add\w*Option$/.test(context ?? "")) optionsExcluded++;
      else if (kind) {
        const name = safeName(literal(node.arguments[0]));
        let declaration = null;
        for (let cursor=node.parent;cursor;cursor=cursor.parent) {
          if (ts.isVariableDeclaration(cursor) && ts.isIdentifier(cursor.name)) { declaration=cursor.name.text;break; }
        }
        symbols.push({kind,name,parent_command:kind.startsWith("subcommand")?rootCommand(node,helpers):null,
          line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,
          declaration, description:literal(chainedArgument(node,"setDescription")),
          detection:"typescript-ast-literal-builder", resolution:name?"literal":"dynamic-name-unresolved"});
      } else unclassifiedSetNames++;
    }
    if(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method=node.expression.name.text;
      const receiver=node.expression.expression.getText(source);
      const first=node.arguments[0];
      const text=literal(first);
      const line=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
      if(["get","post","put","patch","delete","all"].includes(method) && typeof text==="string" && text.startsWith("/"))
        symbols.push({kind:"route",name:`${method.toUpperCase()} ${text}`,line,declaration:receiver,detection:"typescript-ast-http-method-path",resolution:"literal"});
      if(["on","once","addListener"].includes(method) && first) {
        const eventName=typeof text==="string"?text:ts.isPropertyAccessExpression(first)?first.name.text:null;
        if(eventName)symbols.push({kind:"event",name:eventName,line,declaration:receiver,detection:"typescript-ast-event-listener",resolution:"literal"});
      }
      if(method==="setCustomId" && typeof text==="string")
        symbols.push({kind:"component",name:text,line,declaration:receiver,detection:"typescript-ast-custom-id-builder",resolution:"literal"});
      if(["schedule","scheduleJob","setInterval","setTimeout"].includes(method))
        symbols.push({kind:"scheduled job",name:typeof text==="string"?`${method}:${text}`:method,line,declaration:receiver,detection:"typescript-ast-scheduler-call",resolution:typeof text==="string"?"literal":"dynamic-name-unresolved"});
    }
    ts.forEachChild(node,visit);
  }
  visit(source);
  return {symbols,options_excluded:optionsExcluded,unclassified_set_names:unclassifiedSetNames,
    parse_diagnostics:source.parseDiagnostics.map(d=>({code:d.code,line:source.getLineAndCharacterOfPosition(d.start??0).line+1}))};
}
if (process.argv.includes("--symbols")) {
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of lines) {
    try { const request=JSON.parse(line);process.stdout.write(JSON.stringify(analyzeJavaScript(request.path,request.text))+"\n"); }
    catch {process.stdout.write(JSON.stringify({symbols:[],parse_error:"parser-failed"})+"\n");}
  }
} else if (process.argv.includes("--self-test")) {
  const result=analyzeJavaScript("fixture.ts",`const commands=[new SlashCommandBuilder().setName('market').addStringOption(o=>o.setName('query')).addSubcommand(s=>s.setName('buy').addIntegerOption(o=>o.setName('amount')))];`);
  assert.deepEqual(result.symbols.map(s=>[s.kind,s.name,s.parent_command]),[["slash-command","market",null],["subcommand","buy","market"]]);
  assert.equal(result.options_excluded,2);
  assert.equal(analyzeJavaScript("dynamic.ts","new SlashCommandBuilder().setName(value)").symbols[0].resolution,"dynamic-name-unresolved");
  const raw=analyzeJavaScript("commands/fixture.js",`module.exports={data:{name:"referral",description:"command",options:[{type:1,name:"redeem",options:[{type:3,name:"service"}]}]}}`);
  assert.deepEqual(raw.symbols.map(s=>[s.kind,s.name,s.parent_command]),[["slash-command","referral",null],["subcommand","redeem","referral"]]);
  assert.equal(raw.options_excluded,1);
  const helper=analyzeJavaScript("commands/fixture.ts",'const simple=(name:string)=>new SlashCommandBuilder().setName(name);const commands=[simple("rank"),...["welcome","leave"].map(event=>simple(`set${event}`))];');
  assert.deepEqual(helper.symbols.filter(s=>s.name).map(s=>s.name),["rank","setwelcome","setleave"]);
  const capabilities=analyzeJavaScript("routes.ts",`new SlashCommandBuilder().setName("health").setDescription("Show service health");app.post("/api/orders", handler);client.on("guildMemberAdd",handler);new ButtonBuilder().setCustomId("confirm-order");cron.schedule("0 * * * *",handler);`);
  assert.ok(capabilities.symbols.some(s=>s.kind==="slash-command"&&s.description==="Show service health"));
  assert.deepEqual(capabilities.symbols.filter(s=>s.kind!=="slash-command").map(s=>[s.kind,s.name]),[["route","POST /api/orders"],["event","guildMemberAdd"],["component","confirm-order"],["scheduled job","schedule:0 * * * *"]]);
  console.log("Inventory parser self-test: 8 checks passed.");
} else {
  const result=spawnSync(process.env.PYTHON??"python",[join(root,"scripts/inventory-archives.py"),...process.argv.slice(2)],{
    cwd:root,stdio:"inherit",env:{...process.env,PYTHONUTF8:"1",INVENTORY_NODE:process.execPath},windowsHide:true,
  });
  if(result.error) throw result.error;
  process.exitCode=result.status??1;
}

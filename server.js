"use strict";
const http=require("node:http");
const path=require("node:path");
const {timingSafeEqual}=require("node:crypto");
require("dotenv").config({path:path.join(__dirname,".env"),quiet:true});
const {AIService}=require("./lib/ai");
const {fromEnvironment}=require("./lib/providers");

function createServer({ai=new AIService(() => fromEnvironment()),token=process.env.LOCAL_API_TOKEN}={}) {
  return http.createServer(async (req,res) => {
    res.setHeader("Content-Type","application/json; charset=utf-8");
    res.setHeader("Cache-Control","no-store");
    const send=(status,body) => {if (res.writableEnded || res.destroyed) return;res.writeHead(status); res.end(JSON.stringify(body));};
    if (req.method==="GET" && req.url==="/health") return send(200,{status:"ok"});
    if (req.method!=="POST" || req.url!=="/api/ask") return send(404,{error:"Not found"});
    if (!token) return send(503,{error:"Set LOCAL_API_TOKEN before using the local API."});
    const supplied=Buffer.from(req.headers.authorization || "");
    const expected=Buffer.from(`Bearer ${token}`);
    if (supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) return send(401,{error:"Unauthorized"});
    const controller=new AbortController();
    res.on("close",() => {if (!res.writableEnded) controller.abort();});
    try {
      let size=0;
      const chunks=[];
      for await (const chunk of req) {
        size+=chunk.length;
        if (size>65536) return send(413,{error:"Request too large"});
        chunks.push(chunk);
      }
      let body;
      try {body=JSON.parse(Buffer.concat(chunks).toString("utf8"));}
      catch {return send(400,{error:"Invalid JSON"});}
      const answer=await ai.answer(body.question,{mode:body.mode,language:body.language,signal:controller.signal});
      send(200,answer);
    } catch (error) {
      send(error.code==="INVALID_INPUT"?400:502,{error:error.message,code:error.code || "API_ERROR"});
    }
  });
}
if (require.main===module) {
  createServer().listen(Number(process.env.PORT) || 3001,"127.0.0.1",() => console.log("Local API: http://127.0.0.1:3001"));
}
module.exports={createServer};

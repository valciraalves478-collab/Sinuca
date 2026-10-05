// Servidor autoritativo: física, regras, salas e WebSocket (sem dependências externas).
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PUB=__dirname,PORT=process.env.PORT||3000;
const W=500,H=1000,R=14,PR=30,PK=[[0,0],[W,0],[0,H],[W,H],[0,H/2],[W,H/2]];
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const rooms={};

const srv=http.createServer((q,res)=>{
  let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';
  if(u!=='/index.html'){res.writeHead(404);return res.end('404')}const f=path.join(PUB,u);
  fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('404')}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});res.end(d)});
});

// ---- WebSocket mínimo (RFC 6455, mensagens de texto) ----
const frame=s=>{const p=Buffer.from(s),n=p.length;
  return Buffer.concat([n<126?Buffer.from([0x81,n]):Buffer.from([0x81,126,n>>8,n&255]),p])};
srv.on('upgrade',(req,sock)=>{
  const k=req.headers['sec-websocket-key'];if(!k)return sock.destroy();
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+
    crypto.createHash('sha1').update(k+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
  const c={buf:Buffer.alloc(0),name:'Jogador',room:null,send:o=>{if(!sock.destroyed)sock.write(frame(JSON.stringify(o)))}};
  sock.on('data',d=>{c.buf=Buffer.concat([c.buf,d]);
    for(;;){const b=c.buf;if(b.length<2)return;let n=b[1]&127,o=2;
      if(n===126){if(b.length<4)return;n=b.readUInt16BE(2);o=4}else if(n===127)return sock.destroy();
      const mk=b[1]&128;if(mk)o+=4;if(b.length<o+n)return;
      const op=b[0]&15,pl=Buffer.from(b.subarray(o,o+n));
      if(mk)for(let i=0;i<n;i++)pl[i]^=b[o-4+i%4];
      c.buf=b.subarray(o+n);
      if(op===8)return sock.end();
      if(op===1)try{handle(c,JSON.parse(pl.toString()))}catch(e){}}});
  sock.on('close',()=>leave(c));sock.on('error',()=>{});
});

// ---- Salas (matchmaking: 'quick' procura sala pública aberta) ----
const bc=(r,o)=>r.pl.forEach(p=>p.send(o));
function mk(mode,pub){let code;do code=Math.random().toString(36).slice(2,6).toUpperCase();while(rooms[code]);
  return rooms[code]={code,mode,pub,pl:[],g:null}}
function lobby(r){r.pl.forEach((p,i)=>p.send({t:'room',code:r.code,mode:r.mode,you:i,players:r.pl.map(q=>({name:q.name}))}))}
function join(c,r){leave(c);
  if(r.g||r.pl.length>=r.mode)return c.send({t:'err',m:'Sala cheia ou já em jogo'});
  c.room=r;r.pl.push(c);lobby(r);
  if(r.pl.length===r.mode)setTimeout(()=>{if(!r.g&&r.pl.length===r.mode&&rooms[r.code])start(r)},1500)}
function leave(c){const r=c.room;if(!r)return;c.room=null;r.pl=r.pl.filter(p=>p!==c);
  if(r.g&&!r.g.over){bc(r,{t:'left',m:c.name+' saiu da partida'});r.pl.forEach(p=>p.room=null);delete rooms[r.code]}
  else if(!r.pl.length)delete rooms[r.code];
  else{r.g=null;lobby(r)}}
function handle(c,m){
  if(m.name)c.name=String(m.name).slice(0,12);
  switch(m.t){
    case 'create':return join(c,mk(m.mode===4?4:2,false));
    case 'quick':{const md=m.mode===4?4:2;
      return join(c,Object.values(rooms).find(r=>r.pub&&r.mode===md&&!r.g&&r.pl.length<md)||mk(md,true))}
    case 'join':{const r=rooms[String(m.code||'').toUpperCase()];return r?join(c,r):c.send({t:'err',m:'Sala não encontrada'})}
    case 'leave':return leave(c);
    case 'shot':return shot(c,m);
    case 'place':return place(c,m);
    case 'again':{const r=c.room;if(r&&r.g&&r.g.over&&r.pl.length===r.mode)start(r)}
  }}

// ---- Partida ----
function start(r){
  const nums=[1,2,3,4,5,6,7,9,10,11,12,13,14,15].sort(()=>Math.random()-.5);
  const B=[{n:0,x:W/2,y:780}];let k=0;
  for(let row=0;row<5;row++)for(let i=0;i<=row;i++){const idx=k++;
    B.push({n:idx===4?8:nums.pop(),x:W/2+(i-row/2)*(2*R+.5)+(Math.random()-.5)*.8,y:330-row*R*1.75+(Math.random()-.5)*.8})}
  B.forEach(b=>{b.vx=b.vy=0;b.a=true});
  r.g={balls:B,turn:0,groups:[null,null],hand:false,moving:false,over:false,tk:0,pot:[],first:null};
  bc(r,{t:'start'});state(r)}
function state(r){const g=r.g;
  bc(r,{t:'s',b:g.balls.filter(b=>b.a).map(b=>[b.n,+b.x.toFixed(1),+b.y.toFixed(1)]),
    cur:g.turn%r.mode,hand:g.hand,mv:g.moving,gr:g.groups})}
function shot(c,m){const r=c.room,g=r&&r.g;
  if(!g||g.moving||g.over||g.hand||r.pl[g.turn%r.mode]!==c)return;
  const kk=Math.max(1,Math.min(1.35,+m.k||1)),a=+m.a,p=Math.max(.05,Math.min(1,+m.p));if(isNaN(a)||isNaN(p))return;
  const q=g.balls[0];q.vx=Math.cos(a)*p*55*kk;q.vy=Math.sin(a)*p*55*kk;
  g.moving=true;g.first=null;g.pot=[];g.tk=0;state(r)}
function place(c,m){const r=c.room,g=r&&r.g;
  if(!g||!g.hand||g.over||r.pl[g.turn%r.mode]!==c)return;
  const x=Math.max(R,Math.min(W-R,+m.x)),y=Math.max(R,Math.min(H-R,+m.y));if(isNaN(x)||isNaN(y))return;
  if(g.balls.some(b=>b.n&&b.a&&Math.hypot(b.x-x,b.y-y)<2*R))return c.send({t:'msg',m:'Posição ocupada'});
  const q=g.balls[0];q.x=x;q.y=y;q.a=true;g.hand=false;state(r)}

function step(r){const g=r.g,B=g.balls;let mv=false;g.tk++;
  for(let s=0;s<8;s++){
    for(const b of B){if(!b.a)continue;b.x+=b.vx/8;b.y+=b.vy/8;
      if(PK.some(p=>Math.hypot(b.x-p[0],b.y-p[1])<PR)){b.a=false;b.vx=b.vy=0;g.pot.push(b.n);continue}
      if(b.x<R){b.x=R;b.vx=Math.abs(b.vx)*.85}else if(b.x>W-R){b.x=W-R;b.vx=-Math.abs(b.vx)*.85}
      if(b.y<R){b.y=R;b.vy=Math.abs(b.vy)*.85}else if(b.y>H-R){b.y=H-R;b.vy=-Math.abs(b.vy)*.85}}
    for(let it=0;it<2;it++)for(let i=0;i<B.length;i++)for(let j=i+1;j<B.length;j++){
      const a=B[i],b=B[j];if(!a.a||!b.a)continue;
      let dx=b.x-a.x,dy=b.y-a.y;const d=Math.hypot(dx,dy);if(d>=2*R||d===0)continue;
      dx/=d;dy/=d;const o=(2*R-d)/2;a.x-=dx*o;a.y-=dy*o;b.x+=dx*o;b.y+=dy*o;
      const v=(a.vx-b.vx)*dx+(a.vy-b.vy)*dy;
      if(v>0){const k=v*.98;a.vx-=k*dx;a.vy-=k*dy;b.vx+=k*dx;b.vy+=k*dy;
        if(g.first==null&&(a.n===0||b.n===0))g.first=a.n===0?b.n:a.n}}}
  for(const b of B){if(!b.a)continue;b.vx*=.987;b.vy*=.987;
    if(Math.hypot(b.vx,b.vy)<.12)b.vx=b.vy=0;else mv=true}
  if(!mv||g.tk>2400){B.forEach(b=>b.vx=b.vy=0);resolve(r)}}

const grp=n=>n<8?'s':'l';
function end(r,w,m){const g=r.g;g.over=true;g.moving=false;bc(r,{t:'msg',m});state(r);bc(r,{t:'end',w,m})}
function resolve(r){
  const g=r.g,N=r.mode,t=(g.turn%N)%2,B=g.balls,G=g.groups,pot=g.pot;g.moving=false;
  const mine=G[t];let foul=false,why='';
  const left=mine?B.filter(b=>b.n&&b.n!==8&&grp(b.n)===mine&&(b.a||pot.includes(b.n))).length:99;
  if(pot.includes(0)){foul=true;why='Bola branca encaçapada'}
  else if(g.first==null){foul=true;why='Nenhuma bola tocada'}
  else{const fg=g.first===8?'8':grp(g.first);
    if(mine?fg!==(left?mine:'8'):fg==='8'){foul=true;why='Bola errada tocada primeiro'}}
  if(pot.includes(8)){const win=mine&&left===0&&!foul;
    return end(r,win?t:1-t,win?'Bola 8 encaçapada! Vitória!':'Bola 8 encaçapada fora de hora!')}
  if(!mine&&!foul){const f=pot.find(x=>x&&x!==8);
    if(f){G[t]=grp(f);G[1-t]=G[t]==='s'?'l':'s'}}
  const own=pot.some(x=>x&&x!==8&&grp(x)===G[t]);
  let m;
  if(foul){g.turn=(g.turn+1)%N;g.hand=true;const q=B[0];q.a=true;q.x=W/2;q.y=780;
    m='FALTA: '+why+'. Bola na mão para o adversário'}
  else if(own){g.turn=(g.turn+(N===4?2:0))%N;m='Encaçapou! Joga de novo'}
  else{g.turn=(g.turn+1)%N;m='Troca de turno'}
  bc(r,{t:'msg',m});state(r)}

setInterval(()=>{for(const r of Object.values(rooms)){const g=r.g;if(!g||!g.moving)continue;
  step(r);if(g.moving&&g.tk%2===0)state(r)}},16);
srv.listen(PORT,()=>console.log('Sinuca rodando em http://localhost:'+PORT));

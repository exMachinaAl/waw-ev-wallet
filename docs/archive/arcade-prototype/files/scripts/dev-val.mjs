// In-memory demonstration only; never opens data/arcade.sqlite or loads .env.
import {createApp} from '../src/server.mjs';
const app=createApp({database:':memory:',demo:true,host:'127.0.0.1',serviceKey:''});
app.server.listen(3210,'127.0.0.1',()=>console.log('EV-wallet VAL demo: http://127.0.0.1:3210 (in-memory; resets on exit)'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0)});

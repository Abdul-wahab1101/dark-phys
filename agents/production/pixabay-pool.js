'use strict';
const { PixabayFootageClient } = require('../stock-footage/pixabay');
/** Two-key pool. Keys remain in process environment; never returned or logged. */
class PixabayPool {
  constructor(options={}) {
    const keys = options.keys || [process.env.PIXABAY_API_KEY, process.env.PIXABAY_API_KEY_2].filter(Boolean);
    this.clients = [...new Set(keys.filter(Boolean))].map(apiKey => new PixabayFootageClient({...options, apiKey}));
    this.cursor = 0;
  }
  get configured() { return this.clients.length > 0; }
  async search(query, options={}) {
    if (!this.configured) return {status:'needs_api_keys',items:[],message:'Set PIXABAY_API_KEY and optionally PIXABAY_API_KEY_2 locally.'};
    const errors=[];
    for(let i=0;i<this.clients.length;i++) {
      const index=(this.cursor+i)%this.clients.length;
      try { const result=await this.clients[index].search(query,options); this.cursor=index; return {...result,keySlot:index+1}; }
      catch(e) { errors.push(e.message); }
    }
    throw new Error('All configured Pixabay keys failed: '+errors.join(' | '));
  }
  async download(item, options={}) {
    if(!this.configured) throw new Error('Configure Pixabay keys locally first.');
    const errors=[];
    for(let i=0;i<this.clients.length;i++) {
      const index=(this.cursor+i)%this.clients.length;
      try { const result=await this.clients[index].download(item,options); this.cursor=index; return result; }
      catch(e) { errors.push(e.message); }
    }
    throw new Error('Pixabay download failed with all configured keys: '+errors.join(' | '));
  }
}
module.exports={PixabayPool};

import {compareGpu, savedComparison} from '../gpuComparison';
import {measureGpu, type WiredSession} from '../wiredInference';
jest.mock('../wiredInference',()=>({measureGpu:jest.fn()}));

test('keeps the faster measured split for the selected file and devices even if the model cannot fit locally', async()=>{
  const host=jest.fn(async (ids:string[],_file:string,policy:string):Promise<WiredSession>=>{
    if(!ids.length)throw Error('cannot fit locally');
    return {token:policy,model:'test',device:'remote'};
  });
  (measureGpu as jest.Mock).mockImplementation(async (s:WiredSession)=>({firstMs:18,rate:s.token==='equal'?6:11}));
  const stop=jest.fn(async()=>{});
  const result=await compareGpu('sample.gguf',['a','b'],new AbortController().signal,host,stop,()=>{});
  expect(result.policy).toBe('memory');expect(result.samples).toHaveLength(2);expect(result.unavailable[0]).toContain('cannot fit');
  expect(stop).toHaveBeenCalledTimes(2);expect(await savedComparison('sample.gguf',['a','b'])).toEqual(result);
  expect(await savedComparison('sample.gguf',['a'])).toBeNull();
});

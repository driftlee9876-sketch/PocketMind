import {clipTokens} from '../media/diffusion';
test('encodes CLIP start/stop, pairs and fixed 77-token padding',()=>{
  const v={'<|startoftext|>':100,'<|endoftext|>':101,'ca':1,'cat</w>':2,'a</w>':3};
  expect(clipTokens('CAT a',v,'#version: 0.2\nc a\nca t</w>').slice(0,5)).toEqual([100,2,3,101,101]);
  expect(clipTokens('a '.repeat(100),v,'')).toHaveLength(77);
});

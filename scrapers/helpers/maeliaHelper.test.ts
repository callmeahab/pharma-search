import { expect, test } from 'bun:test';
import { parseMaeliaGroups, parseMaeliaPage, parseMaeliaState } from './maeliaHelper';
const group={code:'apoteka-1749',name:'Apoteka'};
function state(data: unknown) {
 const encoded=JSON.stringify(data).replace(/[&"'<>]/g,c=>({'&':'&a;','"':'&q;',"'":'&s;','<':'&l;','>':'&g;'}[c]!));
 return `<script id="ap-root-state" type="application/json">${encoded}</script>`;
}
function page(items: unknown[], current=1) {
 return state({['/site/v1/items'+JSON.stringify({data:JSON.stringify({group_code:group.code,page:current,count:20})})]:{list:items,total:items.length}});
}
test('Maelia discovers current categories rather than stale numeric IDs',()=>{
 expect(parseMaeliaGroups(state({'/site/v1/groups{"is_root":"true"}':{list:[group]}}))).toEqual([group]);
});
test('Maelia decodes Angular escapes exactly once',()=>{
 expect(parseMaeliaState(state({name:'Cink & vitamin C',literal:'&q;',quoted:'"<ok>"'}))).toEqual({name:'Cink & vitamin C',literal:'&q;',quoted:'"<ok>"'});
});
test('Maelia keeps the current price and builds the actual product route',()=>{
 const parsed=parseMaeliaPage(page([{id:1,name:'Vitamin C',code:'vitamin-c-1',group_code:'vitamini-1800',price:539,price_crossed:800,is_available:true,images:['https://images.example/c.jpg']},{id:2,price:0,is_available:false}]),group,1);
 expect(parsed.products).toHaveLength(1);
 expect(parsed.products[0].price).toBe('539');
 expect(parsed.products[0].link).toBe('https://maelia.rs/sr/catalog/vitamini-1800/vitamin-c-1');
});
test('Maelia rejects missing state and repeated pagination',()=>{
 expect(()=>parseMaeliaGroups('<html>changed</html>')).toThrow('missing');
 expect(()=>parseMaeliaPage(page([]),group,2)).toThrow('repeated page');
});

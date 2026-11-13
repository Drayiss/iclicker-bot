const $=id=>document.getElementById(id);
let question=0;
$('begin').onclick=()=>{$('question-number').textContent='Class in session';$('join').hidden=false;$('response').textContent='';};
$('join').onclick=()=>{$('join').hidden=true;$('question-number').textContent='Waiting for next question';};
function next(missing=false){
  question++;$('join').hidden=true;$('response').textContent='';$('submit').hidden=false;
  $('question-number').textContent=`Question ${question}`;$('question-area').replaceChildren();
  if(!missing){const p=document.createElement('p');p.className='question-text';p.textContent=question%3===1?'What is 2 + 2?':question%3===2?'The figure shows a rectangle 3 units wide and 4 units high. What is its area?':'What color is a clear daytime sky? Reply with one word.';$('question-area').append(p);}
  if(question%3===2){const figure=document.createElementNS('http://www.w3.org/2000/svg','svg');figure.setAttribute('width','240');figure.setAttribute('height','170');figure.setAttribute('aria-label','Rectangle: width 3, height 4');figure.innerHTML='<rect x="40" y="15" width="120" height="120" fill="#70dcc0"/><text x="95" y="160" fill="white">3</text><text x="175" y="80" fill="white">4</text>';$('question-area').append(figure);}
  if(question%3===0){const input=document.createElement('input');input.type='text';input.setAttribute('aria-label','Answer');$('question-area').append(input);}
  else for(const answer of (question%3===1?['3','4','5']:['7','12','24'])){const label=document.createElement('label');const input=document.createElement('input');input.type='radio';input.name='answer';input.value=answer;input.style.width='auto';label.append(input,` ${answer}`);$('question-area').append(label);}
}
$('next').onclick=()=>next();$('missing').onclick=()=>next(true);
$('submit').onclick=()=>{const selected=document.querySelector('input[name="answer"]:checked')?.value||document.querySelector('#question-area input[type="text"]')?.value;if(!selected)return;$('response').textContent=`Answer submitted: ${selected}`;$('submit').hidden=true;};
$('end').onclick=()=>{$('question-number').textContent='Class ended';$('question-area').replaceChildren();$('join').hidden=true;$('submit').hidden=true;$('response').textContent='';};

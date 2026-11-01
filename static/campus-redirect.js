// Learner/tutor account links used to land on the market home; send them to Learning.
{const p=new URLSearchParams(location.search);if((p.has('role')&&p.get('role')!=='advertiser')||(p.has('mode')&&!p.has('sell')&&!p.has('create')&&p.get('role')!=='advertiser')||location.hash==='#register')location.replace('/learning'+location.search+location.hash)}

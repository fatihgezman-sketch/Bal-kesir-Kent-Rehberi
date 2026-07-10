/* Runs the expensive address matching work away from the visible interface. */
'use strict';

var dataPromise = null;

function loadData(){
  if (!dataPromise){
    dataPromise = Promise.all([
      fetch('data/index.json').then(requireOk).then(function(r){ return r.json(); }),
      fetch('data/search-index.json').then(requireOk).then(function(r){ return r.json(); })
    ]);
  }
  return dataPromise;
}

function requireOk(response){
  if (!response.ok) throw new Error('Unable to load search data');
  return response;
}

function normalize(value){
  return String(value || '')
    .toLocaleLowerCase('tr')
    .replace(/\u0131/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMatch(guess, target){
  if (!guess || !target) return 0;
  if (guess === target) return 100;
  if (guess.length > 3 && target.indexOf(guess) === -1 && guess.indexOf(target) === -1){
    var words = guess.split(' ');
    var found = words.some(function(word){ return word.length > 2 && target.indexOf(word) !== -1; });
    if (!found) return 0;
  }
  if (target.indexOf(guess) !== -1 || guess.indexOf(target) !== -1) return 80;
  var guessTokens = guess.split(' ');
  var targetTokens = target.split(' ');
  var common = guessTokens.filter(function(token){ return token && targetTokens.indexOf(token) !== -1; }).length;
  return common ? Math.round(60 * common / Math.max(guessTokens.length, targetTokens.length)) : 0;
}

function splitAtKeyword(text, expression){
  var match = text.match(expression);
  return match ? { before: text.slice(0, match.index).trim(), after: text.slice(match.index + match[0].length).trim() } : null;
}

function parseQuery(raw){
  var text = normalize(raw);
  var mahalle = null;
  var sokak = null;
  var number = null;
  var block = '';
  var mahalleSplit = splitAtKeyword(text, /\b(mahallesinde|mahallesi|mahallenin|mahalle)\b/);
  if (mahalleSplit){ mahalle = mahalleSplit.before; text = mahalleSplit.after; }
  var sokakSplit = splitAtKeyword(text, /\b(sokaginda|sokagi|sokak\w*|caddesinde|caddesi|cadde\w*|sk|cd)\b/);
  if (sokakSplit){ sokak = sokakSplit.before.replace(/[.,]+$/, '').trim(); text = sokakSplit.after; }
  var numberMatch = text.match(/(\d+)\s*([a-z]{0,2})/i);
  if (numberMatch){ number = numberMatch[1]; block = (numberMatch[2] || '').toUpperCase(); }
  if (!mahalle && !sokak) sokak = normalize(raw);
  return { mahalleGuess: mahalle, sokakGuess: sokak, no: number, blok: block };
}

function search(raw, index, searchIndex){
  var parsed = parseQuery(raw);
  var mahalleGuess = normalize(parsed.mahalleGuess);
  var sokakGuess = normalize(parsed.sokakGuess);
  var candidates = [];
  Object.keys(index).forEach(function(district){
    Object.keys(index[district]).forEach(function(neighborhood){
      var slug = index[district][neighborhood];
      var score = mahalleGuess ? scoreMatch(mahalleGuess, normalize(neighborhood)) : 10;
      if (score) candidates.push({ ilce: district, mahalle: neighborhood, slug: slug, score: score });
    });
  });
  candidates.sort(function(a, b){ return b.score - a.score; });
  var selected = candidates.slice(0, 6);
  if (!selected.length){
    Object.keys(index).forEach(function(district){
      Object.keys(index[district]).forEach(function(neighborhood){
        selected.push({ ilce: district, mahalle: neighborhood, slug: index[district][neighborhood], score: 0 });
      });
    });
  }
  var results = [];
  selected.forEach(function(candidate){
    var streets = (searchIndex[candidate.ilce] && searchIndex[candidate.ilce][candidate.slug]) || [];
    streets.forEach(function(street){
      var streetScore = sokakGuess ? scoreMatch(sokakGuess, normalize(street)) : 5;
      if (streetScore) results.push({ ilce: candidate.ilce, mahalle: candidate.mahalle, slug: candidate.slug, sokak: street, score: candidate.score * 100 + streetScore });
    });
  });
  results.sort(function(a, b){ return b.score - a.score; });
  return { parsed: parsed, results: results.slice(0, 8) };
}

self.addEventListener('message', function(event){
  var request = event.data;
  loadData().then(function(data){
    var result = search(request.query, data[0], data[1]);
    self.postMessage({ id: request.id, result: result });
  }).catch(function(){
    self.postMessage({ id: request.id, error: true });
  });
});

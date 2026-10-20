// Историческая карта (версия на полных данных Cliopatria) - основной скрипт

var karta = L.map('karta', { preferCanvas: true, zoomControl: false, minZoom: 2, worldCopyJump: true })
  .setView([48, 40], 4);
L.control.zoom({ position: 'topright' }).addTo(karta);
karta.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
karta.attributionControl.addAttribution('границы: Cliopatria (Seshat), без изменений · реки и суша: Natural Earth');

// слои по порядку снизу вверх: суша, страны, реки и озёра
karta.createPane('susha').style.zIndex = 350;
karta.createPane('reki').style.zIndex = 450;
karta.getPane('reki').style.pointerEvents = 'none';

var god = 1700;          // выбранный год (до н. э. — отрицательный)
var MIN_GOD = -3400, MAX_GOD = 2024;
var klyuchNabora = null; // какие куски границ сейчас на карте
var dekodirovano = {};   // уже разобранные куски, чтобы не делать заново
var tekSloy = null;
var vydelennye = [];
var taymer = null;       // для кнопки «проиграть»
var tochkaStolicy = null; // точка со столицей нашей страны
var podpisi = L.layerGroup().addTo(karta); // названия стран на карте
var vybor = null;        // выбранная страна: { strana, name, tochka }

var cveta = ['#f6c945', '#8fd16a', '#b98be6', '#f7955e', '#5fb4ee', '#e3dc3f', '#4fd1b0', '#f58fb8', '#b4dd4c', '#f4b183', '#9db2ff', '#6fd6e0'];

// ---------- помощники ----------

function naGod(spisok, g) {
  // все записи [с, по, текст], которые подходят под год
  var res = [];
  for (var i = 0; i < spisok.length; i++) {
    if (spisok[i][0] <= g && g <= spisok[i][1]) res.push(spisok[i]);
  }
  return res;
}

function pervyyNaGod(spisok, g) {
  var r = naGod(spisok, g);
  return r.length ? r[r.length - 1][2] : null;
}

// в каком куске данных лежит этот год
function blokDlyaGoda(g) {
  for (var i = 0; i < blokiGranic.length; i++) {
    if (blokiGranic[i][0] <= g && g <= blokiGranic[i][1]) return blokiGranic[i][0];
  }
  return blokiGranic[blokiGranic.length - 1][0];
}

// Координаты в файлах записаны коротко: целые числа (градусы * 100),
// и каждая точка — это сдвиг от предыдущей. Здесь разворачиваем обратно.
function razvernutKolco(kod) {
  var res = [], x = 0, y = 0;
  for (var i = 0; i < kod.length; i += 2) {
    x += kod[i]; y += kod[i + 1];
    res.push([x / 100, y / 100]);
  }
  return res;
}

function razvernutPoligony(poligony) {
  return poligony.map(function (p) { return p.map(razvernutKolco); });
}

function cvetStrany(name) {
  if (nashaNazvaniya.indexOf(name) != -1) return '#d3222a';
  if (russkieKnyazhestva.indexOf(name) != -1) return '#f07a6a';
  var s = 0;
  for (var i = 0; i < name.length; i++) s = s + name.charCodeAt(i) * (i + 1);
  return cveta[s % cveta.length];
}

function stil(feature) {
  return {
    fillColor: cvetStrany(feature.properties.C || feature.properties.NAME),
    fillOpacity: 0.85,
    color: '#4a4035',
    weight: 0.8
  };
}

// лежит ли точка внутри страны (метод луча)
function vKontureLi(kontur, x, y) {
  var vnutri = false;
  for (var i = 0, j = kontur.length - 1; i < kontur.length; j = i++) {
    var xi = kontur[i][0], yi = kontur[i][1], xj = kontur[j][0], yj = kontur[j][1];
    if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) vnutri = !vnutri;
  }
  return vnutri;
}

function tochkaVStrane(feature, x, y) {
  var g = feature.geometry;
  var mnogo = g.type == 'Polygon' ? [g.coordinates] : g.coordinates;
  for (var i = 0; i < mnogo.length; i++) {
    if (!vKontureLi(mnogo[i][0], x, y)) continue;
    var vDyrke = false;
    for (var k = 1; k < mnogo[i].length; k++) {
      if (vKontureLi(mnogo[i][k], x, y)) vDyrke = true;
    }
    if (!vDyrke) return true;
  }
  return false;
}

function stolicaNaGod(strana, g) {
  var nazv = pervyyNaGod(strana.stolicy, g);
  return nazv ? { nazv: nazv, xy: goroda[nazv] } : null;
}

// страны из нашего списка, которые есть в этом году
function stranyNaGod(g) {
  var res = [];
  for (var i = 0; i < strany.length; i++) {
    if (pervyyNaGod(strany[i].nazvaniya, g)) res.push(strany[i]);
  }
  return res;
}

// ---------- карта ----------

// подложка: суша, озёра и реки
function narisovatOsnovu() {
  var sushaRis = L.canvas({ pane: 'susha' });
  var rekiRis = L.canvas({ pane: 'reki' });
  L.geoJSON({ type: 'MultiPolygon', coordinates: razvernutPoligony(osnova.susha) }, {
    pane: 'susha', renderer: sushaRis, interactive: false,
    style: { stroke: false, fillColor: '#eee6d2', fillOpacity: 1 }
  }).addTo(karta);
  L.geoJSON({ type: 'MultiPolygon', coordinates: razvernutPoligony(osnova.ozera) }, {
    pane: 'reki', renderer: rekiRis, interactive: false,
    style: { color: '#6a9fc0', weight: 0.6, fillColor: '#a9d2e6', fillOpacity: 1 }
  }).addTo(karta);
  L.geoJSON({ type: 'MultiLineString', coordinates: osnova.reki.map(function (r) { return razvernutKolco(r[1]); }) }, {
    pane: 'reki', renderer: rekiRis, interactive: false,
    style: { color: '#4f8fc0', weight: 1.1, opacity: 0.85 }
  }).addTo(karta);
}

function zagruzitBlok(b, gotovo) {
  if (granicy[b]) { gotovo(); return; }
  document.getElementById('zagruzka').hidden = false;
  var s = document.createElement('script');
  s.src = 'cliopatria/' + b + '.js';
  s.onload = function () {
    document.getElementById('zagruzka').hidden = true;
    zabytStaryeBloki(b);
    gotovo();
  };
  s.onerror = function () {
    document.getElementById('zagruzka').innerHTML = 'не получилось загрузить границы';
  };
  document.body.appendChild(s);
}

// Куски большие (до 10 МБ), поэтому в памяти держим только нужный кусок и соседние
function zabytStaryeBloki(b) {
  var n = 0;
  for (var i = 0; i < blokiGranic.length; i++) if (blokiGranic[i][0] == b) n = i;
  var nuzhnye = [n - 1, n, n + 1].map(function (i) { return blokiGranic[i] ? blokiGranic[i][0] : null; });
  for (var k in granicy) {
    if (nuzhnye.indexOf(Number(k)) == -1) {
      delete granicy[k];
      for (var d in dekodirovano) if (d.indexOf(k + '-') == 0) delete dekodirovano[d];
    }
  }
}

// запись в куске: [запись из Cliopatria без изменений, точка для подписи]
// В записи Cliopatria: Name — название, FromYear и ToYear — годы, geometry — границы
function stranaIzZapisi(b, i) {
  var klyuch = b + '-' + i;
  if (!dekodirovano[klyuch]) {
    var z = granicy[b][i];
    var p = z[0].properties;
    dekodirovano[klyuch] = {
      type: 'Feature',
      properties: { NAME: p.Name, s: p.FromYear, e: p.ToYear, L: z[1], wiki: p.Wikipedia },
      geometry: z[0].geometry
    };
  }
  return dekodirovano[klyuch];
}

tekSloy = L.geoJSON(null, {
  style: stil,
  onEachFeature: function (feature, layer) {
    layer.on('click', function (e) {
      vybratNaKarte(feature, [e.latlng.lng, e.latlng.lat]);
    });
  }
}).addTo(karta);

// показать границы на выбранный год
function pokazatGranicy(g) {
  var b = blokDlyaGoda(g);
  zagruzitBlok(b, function () {
    if (god != g) return; // пока грузилось, год уже поменяли
    var nomera = [];
    for (var i = 0; i < granicy[b].length; i++) {
      var p = granicy[b][i][0].properties;
      if (p.FromYear <= g && g <= p.ToYear) nomera.push(i);
    }
    var klyuch = b + ':' + nomera.join(',');
    if (klyuch != klyuchNabora) {
      // набор стран поменялся — перерисовываем
      ubratVydelenie();
      tekSloy.clearLayers();
      tekSloy.addData(nomera.map(function (i) { return stranaIzZapisi(b, i); }));
      if (tochkaStolicy) tochkaStolicy.bringToFront();
      klyuchNabora = klyuch;
      sdelatPodpisi();
    }
    primenitVybor();
    zaranee(b);
  });
}

// заранее грузим следующий кусок, чтобы ползунок не тормозил
function zaranee(b) {
  for (var i = 0; i < blokiGranic.length; i++) {
    if (blokiGranic[i][0] == b && i + 1 < blokiGranic.length) {
      var sled = blokiGranic[i + 1][0];
      if (!granicy[sled] && !document.getElementById('blok-' + sled)) {
        var s = document.createElement('script');
        s.src = 'cliopatria/' + sled + '.js';
        s.id = 'blok-' + sled;
        document.body.appendChild(s);
      }
    }
  }
}

function ubratVydelenie() {
  for (var i = 0; i < vydelennye.length; i++) tekSloy.resetStyle(vydelennye[i]);
  vydelennye = [];
}

function vydelit(layer) {
  layer.setStyle({ color: '#111', weight: 2.5 });
  layer.bringToFront();
  if (tochkaStolicy) tochkaStolicy.bringToFront();
  vydelennye.push(layer);
}

// ---------- выбранная страна ----------
// Выбор остаётся, когда листаешь годы. Если это страна из нашего списка,
// её ищем по столице (название в картах меняется), иначе — по названию.

function stranaPoStolice(feature) {
  var spisok = stranyNaGod(god);
  for (var i = 0; i < spisok.length; i++) {
    var st = stolicaNaGod(spisok[i], god);
    if (st && tochkaVStrane(feature, st.xy[0], st.xy[1])) return spisok[i];
  }
  return null;
}

function vybratNaKarte(feature, tochka) {
  vybor = { strana: stranaPoStolice(feature), name: feature.properties.NAME, tochka: tochka };
  primenitVybor();
  document.getElementById('stolbec').scrollTop = 0;
}

// показать страну из списка справа
function pokazatStranu(strana) {
  var st = stolicaNaGod(strana, god);
  if (!st || !tekSloy) return;
  vybor = { strana: strana, name: null, tochka: st.xy };
  var granicy = primenitVybor();
  // центр — столица, а масштаб такой, чтобы страна примерно влезла
  var zoom = granicy ? Math.max(3, Math.min(5, karta.getBoundsZoom(granicy) + 1)) : 5;
  karta.flyTo([st.xy[1], st.xy[0]], zoom, { duration: 0.6 });
  document.getElementById('stolbec').scrollTop = 0;
}

// найти на текущей карте все части выбранной страны
function najtiVybrannye() {
  var res = [];
  if (!vybor || !tekSloy) return res;
  var name = null, tochka = vybor.tochka;
  if (vybor.strana) {
    var st = stolicaNaGod(vybor.strana, god);
    if (!st) return res; // в этом году такой страны нет
    tochka = st.xy;
  } else {
    tekSloy.eachLayer(function (layer) {
      if (layer.feature.properties.NAME == vybor.name) name = vybor.name;
    });
  }
  if (!name) {
    tekSloy.eachLayer(function (layer) {
      if (!name && tochkaVStrane(layer.feature, tochka[0], tochka[1])) name = layer.feature.properties.NAME;
    });
  }
  if (!name) return res;
  tekSloy.eachLayer(function (layer) {
    if (layer.feature.properties.NAME == name) res.push(layer);
  });
  return res;
}

function primenitVybor() {
  var blok = document.getElementById('klik-info');
  if (!vybor) {
    blok.hidden = true;
    if (tekSloy) ubratVydelenie();
    return null;
  }
  if (!tekSloy) return null;
  ubratVydelenie();
  var chasti = najtiVybrannye();
  var granicy = null;
  for (var i = 0; i < chasti.length; i++) {
    vydelit(chasti[i]);
    if (granicy == null) granicy = L.latLngBounds(chasti[i].getBounds().getSouthWest(), chasti[i].getBounds().getNorthEast());
    else granicy.extend(chasti[i].getBounds());
  }
  pokazatKlik(chasti.length ? chasti[0].feature : null);
  return granicy;
}

// ---------- столбец справа ----------

function pravitelHtml(strana) {
  var pr = naGod(strana.praviteli, god);
  var html = '';
  for (var i = 0; i < pr.length; i++) {
    html += '<div class="pravitel">' + pr[i][2] + ' <span class="gody">(' + pr[i][0] + (pr[i][1] != pr[i][0] ? '–' + pr[i][1] : '') + ')</span></div>';
  }
  return html;
}

function postavitStolicu(st) {
  if (!st) {
    if (tochkaStolicy) karta.removeLayer(tochkaStolicy);
    tochkaStolicy = null;
    return;
  }
  var ll = [st.xy[1], st.xy[0]];
  if (!tochkaStolicy) {
    tochkaStolicy = L.circleMarker(ll, { radius: 5, color: '#fff', weight: 2, fillColor: '#111', fillOpacity: 1, interactive: false })
      .bindTooltip('', { permanent: true, direction: 'right', className: 'podpis-stolicy', offset: [6, 0] })
      .addTo(karta);
  }
  tochkaStolicy.setLatLng(ll);
  tochkaStolicy.setTooltipContent(st.nazv);
  tochkaStolicy.bringToFront();
}

function pokazatNashu() {
  var blok = document.getElementById('nasha-blok');
  var nasha = strany[0];
  var nazv = pervyyNaGod(nasha.nazvaniya, god);
  postavitStolicu(nazv ? stolicaNaGod(nasha, god) : null);
  if (!nazv) {
    blok.innerHTML = '<div class="metka-malaya">Наша страна</div>' +
      '<div class="nasha-nazv">Государства ещё нет</div>' +
      '<div>На этих землях живут восточные славяне, финно-угорские и балтские племена. Русь появится в 862 году.</div>';
    return;
  }
  var st = stolicaNaGod(nasha, god);
  blok.innerHTML = '<div class="metka-malaya">Наша страна</div>' +
    '<div class="nasha-nazv">' + nazv + '</div>' +
    '<div class="metka-malaya">Правитель</div>' + pravitelHtml(nasha) +
    '<div class="stolica">Столица: ' + st.nazv + ' · <button class="knopka-mal" id="nasha-pokazat">показать на карте</button></div>';
  document.getElementById('nasha-pokazat').onclick = function () { pokazatStranu(nasha); };
}

function pokazatPraviteley() {
  var blok = document.getElementById('praviteli');
  blok.innerHTML = '';
  var spisok = stranyNaGod(god);
  for (var i = 0; i < spisok.length; i++) {
    var s = spisok[i];
    if (s.nasha) continue;
    var st = stolicaNaGod(s, god);
    var div = document.createElement('div');
    div.className = 'strana';
    div.innerHTML = '<div class="strana-verh"><span class="strana-nazv">' + pervyyNaGod(s.nazvaniya, god) + '</span></div>' +
      pravitelHtml(s) +
      '<div class="stolica">Столица: ' + st.nazv + ' · </div>';
    var knopka = document.createElement('button');
    knopka.className = 'knopka-mal';
    knopka.innerHTML = 'показать на карте';
    knopka.onclick = (function (strana) { return function () { pokazatStranu(strana); }; })(s);
    div.querySelector('.stolica').appendChild(knopka);
    blok.appendChild(div);
  }
  if (blok.innerHTML == '') blok.innerHTML = '<p class="pusto">Нет данных.</p>';
}

function pokazatSobytiya() {
  var blok = document.getElementById('sobytiya');
  var html = '';
  var ranshe = [], pozzhe = [];
  for (var i = 0; i < sobytiya.length; i++) {
    var s = sobytiya[i];
    if (s[0] == god) html += '<p class="sobytie"><b>' + s[0] + '.</b> ' + s[1] + '</p>';
    else if (s[0] < god) ranshe.push(s);
    else pozzhe.push(s);
  }
  if (html == '') html = '<p class="pusto">В этом году в моём списке событий нет.</p>';
  var drugie = ranshe.slice(-2).concat(pozzhe.slice(0, 3));
  if (drugie.length) {
    html += '<div class="metka-malaya" style="margin-top:10px">Рядом по времени</div>';
    for (var k = 0; k < drugie.length; k++) {
      html += '<button class="sobytie-drugoe" data-god="' + drugie[k][0] + '"><span class="g">' + drugie[k][0] + '</span>' + drugie[k][1] + '</button>';
    }
  }
  blok.innerHTML = html;
  var knopki = blok.querySelectorAll('.sobytie-drugoe');
  for (var j = 0; j < knopki.length; j++) {
    knopki[j].onclick = function () { ustanovitGod(parseInt(this.getAttribute('data-god'))); };
  }
}

function pokazatKlik(feature) {
  var html = '<button class="zakryt" id="klik-zakryt" title="Снять выбор">×</button>';
  html += '<div class="malo">выбрано · сохранится, если листать годы</div>';

  if (vybor.strana) {
    var nazv = pervyyNaGod(vybor.strana.nazvaniya, god);
    if (nazv) {
      var st = stolicaNaGod(vybor.strana, god);
      html += '<div class="klik-nazv">' + nazv + '</div>' + pravitelHtml(vybor.strana) +
        '<div class="malo">столица: ' + st.nazv + '</div>';
      if (feature) html += '<div class="malo">на карте: ' + poRusski(feature.properties.NAME) + '</div>';
    } else {
      var vse = vybor.strana.nazvaniya;
      html += '<div class="klik-nazv">' + vse[god < vse[0][0] ? 0 : vse.length - 1][2] + '</div>' +
        '<div class="malo">в ' + god + ' году этого государства ' + (god < vse[0][0] ? 'ещё' : 'уже') + ' нет (оно было в ' +
        vse[0][0] + '–' + vse[vse.length - 1][1] + ' гг.)</div>';
    }
  } else if (feature) {
    var p = feature.properties;
    html += '<div class="klik-nazv">' + poRusski(p.NAME) + '</div>';
    if (p.NAME != vybor.name) html += '<div class="malo">на этом месте раньше было: ' + poRusski(vybor.name) + '</div>';
    if (p.SUBJECTO && p.SUBJECTO != p.NAME) html += '<div class="malo">подчиняется: ' + poRusski(p.SUBJECTO) + '</div>';
    html += '<div class="malo">в данных Cliopatria: ' + tekstGoda(p.s) + ' — ' + tekstGoda(p.e) + '</div>';
    html += '<div class="malo" style="margin-top:6px">Про правителей этой страны у меня пока нет данных.</div>';
  } else {
    html += '<div class="klik-nazv">' + poRusski(vybor.name) + '</div><div class="malo">на карте этого года её нет</div>';
  }

  var blok = document.getElementById('klik-info');
  blok.innerHTML = html;
  blok.hidden = false;
  document.getElementById('klik-zakryt').onclick = function () {
    vybor = null;
    primenitVybor();
  };
}

// ---------- названия стран на карте ----------
// В файле карты для каждой страны есть точка L = [долгота, широта, радиус]:
// центр самого большого круга, который влезает в страну.
// Если название влезает в этот круг — пишем его на карте, если нет — только при наведении.

function razbitNaStroki(tekst) {
  var slova = tekst.split(' ');
  if (slova.length < 2) return [tekst];
  var luchshe = [tekst], min = 1e9;
  for (var i = 1; i < slova.length; i++) {
    var a = slova.slice(0, i).join(' '), b = slova.slice(i).join(' ');
    var d = Math.max(a.length, b.length);
    if (d < min) { min = d; luchshe = [a, b]; }
  }
  return luchshe;
}

function sdelatPodpisi() {
  podpisi.clearLayers();
  if (!tekSloy) return;
  var z = karta.getZoom();
  var pxNaGradus = 256 * Math.pow(2, z) / 360;
  var vidno = karta.getBounds().pad(0.3);

  // у одной страны может быть несколько кусков — подписываем самый большой
  var glavnye = {};
  tekSloy.eachLayer(function (layer) {
    var p = layer.feature.properties;
    if (!p.L) return;
    if (!glavnye[p.NAME] || glavnye[p.NAME].feature.properties.L[2] < p.L[2]) glavnye[p.NAME] = layer;
  });

  tekSloy.eachLayer(function (layer) {
    var p = layer.feature.properties;
    var est = false;
    if (glavnye[p.NAME] == layer && p.L && p.L[2] > 0) {
      var r = p.L[2] * pxNaGradus;   // радиус круга в пикселях
      var tekst = poRusski(p.NAME);
      var nasha = nashaNazvaniya.indexOf(p.NAME) != -1;
      var razmer = r > 120 ? 15 : (r > 50 ? 13 : 11);
      var stroki = [tekst];
      var shirina = tekst.length * razmer * 0.56;
      if (shirina > r * 3.2) {
        stroki = razbitNaStroki(tekst);
        shirina = Math.max(stroki[0].length, (stroki[1] || '').length) * razmer * 0.56;
      }
      var vysota = stroki.length * razmer * 1.15;
      if (shirina <= r * 3.2 && vysota <= r * 2 && r >= 9) {
        est = true;
        var ll = L.latLng(p.L[1], p.L[0]);
        if (vidno.contains(ll)) {
          L.marker(ll, {
            interactive: false,
            keyboard: false,
            icon: L.divIcon({
              className: 'podpis-strany' + (nasha ? ' podpis-nasha' : ''),
              html: '<div style="font-size:' + razmer + 'px">' + stroki.join('<br>') + '</div>',
              iconSize: [Math.ceil(shirina) + 8, Math.ceil(vysota) + 4],
              iconAnchor: [Math.ceil(shirina / 2) + 4, Math.ceil(vysota / 2) + 2]
            })
          }).addTo(podpisi);
        }
      }
    }
    // у маленьких стран название показываем при наведении
    if (!est && !layer.getTooltip()) {
      layer.bindTooltip(poRusski(p.NAME), { sticky: true, className: 'podskazka', direction: 'top', offset: [0, -8] });
    } else if (est && layer.getTooltip()) {
      layer.unbindTooltip();
    }
  });
}

karta.on('moveend', sdelatPodpisi);

// ---------- главная функция ----------

// «−500» пишем как «500 г. до н. э.»
function tekstGoda(g) {
  return g < 0 ? (-g) + ' г. до н. э.' : g + ' г.';
}

function ustanovitGod(g) {
  if (isNaN(g)) return;
  g = Math.max(MIN_GOD, Math.min(MAX_GOD, g));
  if (g == 0) g = (god < 0 ? 1 : -1); // года «ноль» не было
  god = g;
  document.getElementById('polzunok').value = g;
  document.getElementById('vvod-goda').value = g;
  document.getElementById('god').innerHTML = Math.abs(g);
  document.getElementById('god-podpis').innerHTML = g < 0 ? 'г. до н. э.' : 'год';

  document.getElementById('karta-god').innerHTML = tekstGoda(g);

  pokazatNashu();
  pokazatSobytiya();
  pokazatPraviteley();
  pokazatGranicy(g);

  if (window.history && history.replaceState) history.replaceState(null, '', '#' + g);
}

// ---------- ползунок и кнопки ----------

function sdelatMetki() {
  var blok = document.getElementById('metki');
  function proc(g) { return ((g - MIN_GOD) / (MAX_GOD - MIN_GOD) * 100) + '%'; }
  for (var g = -3000; g < MAX_GOD; g += 500) {
    var m = document.createElement('div');
    m.className = 'metka';
    m.style.left = proc(g);
    blok.appendChild(m);
  }
  [-3000, -2000, -1000, 1, 1000, 2000].forEach(function (g) {
    var p = document.createElement('div');
    p.className = 'metka-podpis';
    p.style.left = proc(g);
    p.innerHTML = g < 0 ? (-g) + ' до н. э.' : g;
    blok.appendChild(p);
  });
}

function stop() {
  clearInterval(taymer);
  taymer = null;
  document.getElementById('play').innerHTML = '▶';
}

function play() {
  if (taymer) { stop(); return; }
  if (god >= MAX_GOD) ustanovitGod(MIN_GOD);
  document.getElementById('play').innerHTML = '❚❚';
  taymer = setInterval(function () {
    if (god >= MAX_GOD) { stop(); return; }
    ustanovitGod(god + (god < 0 ? 5 : 1)); // до нашей эры листаем по 5 лет, иначе очень долго
  }, 60);
}

document.getElementById('polzunok').oninput = function () {
  ustanovitGod(parseInt(this.value));
};
document.getElementById('vvod-goda').onchange = function () {
  stop();
  ustanovitGod(parseInt(this.value));
};
document.getElementById('minus').onclick = function () { stop(); ustanovitGod(god - 1); };
document.getElementById('plus').onclick = function () { stop(); ustanovitGod(god + 1); };
document.getElementById('play').onclick = play;

document.addEventListener('keydown', function (e) {
  var t = e.target.tagName;
  if (t == 'INPUT' || t == 'TEXTAREA') return;
  if (e.key == 'ArrowLeft') { stop(); ustanovitGod(god - (e.shiftKey ? 10 : 1)); e.preventDefault(); }
  if (e.key == 'ArrowRight') { stop(); ustanovitGod(god + (e.shiftKey ? 10 : 1)); e.preventDefault(); }
  if (e.key == ' ') { play(); e.preventDefault(); }
  if (e.key == 'Escape') document.getElementById('okno').hidden = true;
});

document.getElementById('o-proekte').onclick = function () { document.getElementById('okno').hidden = false; };
document.getElementById('zakryt').onclick = function () { document.getElementById('okno').hidden = true; };
document.getElementById('okno').onclick = function (e) { if (e.target == this) this.hidden = true; };

// ---------- старт ----------

// год можно написать в адресе: index.html#1812 или index.html#-500 (до н. э.)
window.onhashchange = function () {
  var g = parseInt(location.hash.replace('#', ''));
  if (g >= MIN_GOD && g <= MAX_GOD && g != god) ustanovitGod(g);
};

narisovatOsnovu();
sdelatMetki();
var izSsylki = parseInt(location.hash.replace('#', ''));
ustanovitGod(izSsylki >= MIN_GOD && izSsylki <= MAX_GOD ? izSsylki : 1700);

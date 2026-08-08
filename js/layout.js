// -----------------------------------------------------------------------
// LAYOUT — рачуна позиције кутија и линија за приказ стабла.
// Ради генерички за било који број људи (тестирано концептуално и за 300+).
// -----------------------------------------------------------------------

const LAYOUT = (() => {
  const NODE_W = 176;
  const NODE_H = 196;
  const COUPLE_GAP = 18;
  const UNIT_GAP = 50;
  const ROW_HEIGHT = 280;

  function buildLayout(people) {
    const byId = new Map(people.map(p => [p.id, p]));

    // 1) генерација сваке особе (0 = најстарија позната генерација)
    //    Особа без родитеља у бази (нпр. снаја/зет ушли у породицу) наслеђује
    //    генерацију свог брачног партнера, ако је позната.
    const genCache = new Map();
    function generationOf(id, visiting) {
      if (genCache.has(id)) return genCache.get(id);
      visiting = visiting || new Set();
      if (visiting.has(id)) return null; // заштита од циклуса (нпр. пар без родитеља)
      visiting.add(id);

      const person = byId.get(id);
      let g = null;
      const knownParents = person && person.parents ? person.parents.filter(pid => byId.has(pid)) : [];
      if (knownParents.length) {
        const parentGens = knownParents.map(pid => generationOf(pid, visiting)).filter(x => x !== null);
        if (parentGens.length) g = 1 + Math.max(...parentGens);
      }
      if (g === null && person && person.spouse && byId.has(person.spouse)) {
        const sg = generationOf(person.spouse, visiting);
        if (sg !== null) g = sg;
      }
      if (g === null) g = 0;

      visiting.delete(id);
      genCache.set(id, g);
      return g;
    }
    people.forEach(p => generationOf(p.id));

    // 2) спајање у "јединице" (пар или појединац)
    const unitOfPerson = new Map();
    const units = [];
    people.forEach((p, idx) => {
      if (unitOfPerson.has(p.id)) return;
      const spouse = p.spouse && byId.has(p.spouse) ? byId.get(p.spouse) : null;
      const sameGenSpouse = spouse && generationOf(spouse.id) === generationOf(p.id);
      const members = sameGenSpouse ? [p, spouse] : [p];
      const unit = {
        id: "u_" + p.id,
        members,
        gen: generationOf(p.id),
        order: idx,
        children: [],
        x: 0, // центар (попуњава се касније)
        y: generationOf(p.id) * ROW_HEIGHT
      };
      members.forEach(m => unitOfPerson.set(m.id, unit));
      units.push(unit);
    });

    // 3) деца свакe јединице = јединице чији члан има родитеља у овој јединици
    //    НАПОМЕНА: ако су се две "родоначелничке" линије спојиле браком (нпр.
    //    ћерка једног пара се удала за сина другог пара из исте базе), пар
    //    њихове деце технички има родитеље у ДВЕ различите јединице. За сврху
    //    распореда (ширина/позиција) свака јединица-дете сме имати само ЈЕДНОГ
    //    "власника" огранка — иначе се читав под-огранак рачуна двапут (простор
    //    се резервише на два места) а физички исцртава само на једном. Другог,
    //    "изгубљеног" родитеља не остављамо да лебди негде далеко — у кораку 7б
    //    га закачимо као "сателит" тачно изнад његовог детета, са супротне
    //    стране пара од оног родитеља-власника (лево/десно око пара).
    const claimedChildUnit = new Set();
    const extraParentLinks = []; // {childUnit, ownerUnit, otherUnit, ownerChildId, otherChildId}
    units.forEach(u => {
      const memberIds = new Set(u.members.map(m => m.id));
      const childUnitIds = new Set();
      people.forEach(p => {
        if (!p.parents) return;
        if (p.parents.some(pid => memberIds.has(pid))) {
          const cu = unitOfPerson.get(p.id);
          if (!cu || cu.id === u.id) return;
          if (!claimedChildUnit.has(cu.id)) {
            childUnitIds.add(cu.id);
            claimedChildUnit.add(cu.id);
          } else {
            extraParentLinks.push({ childUnit: cu, otherUnit: u, otherChildId: p.id });
          }
        }
      });
      u.children = units
        .filter(x => childUnitIds.has(x.id))
        .sort((a, b) => a.order - b.order);
    });

    // 4) корени = јединице које нико не наводи као дете
    const referencedAsChild = new Set();
    units.forEach(u => u.children.forEach(c => referencedAsChild.add(c.id)));
    let roots = units.filter(u => !referencedAsChild.has(u.id)).sort((a, b) => a.order - b.order);

    // 4б) допунимо линкове са информацијом ко је "власник" (родитељ који је
    //     задржао дете у свом u.children), и издвојимо "сателите" — родитељске
    //     јединице без сопствене деце које су изгубиле спор за власништво —
    //     из главног низа корена, да их не рачунамо у ширину читавог стабла.
    extraParentLinks.forEach(link => {
      const owner = units.find(u => u.children.includes(link.childUnit));
      if (!owner) return;
      link.ownerUnit = owner;
      const ownerMemberIds = new Set(owner.members.map(m => m.id));
      const ownerChild = link.childUnit.members.find(
        m => m.parents && m.parents.some(pid => ownerMemberIds.has(pid))
      );
      link.ownerChildId = ownerChild ? ownerChild.id : null;
    });
    const satelliteLinks = extraParentLinks.filter(
      link => link.otherUnit.children.length === 0 && roots.includes(link.otherUnit)
    );
    const satelliteUnitIds = new Set(satelliteLinks.map(l => l.otherUnit.id));
    roots = roots.filter(u => !satelliteUnitIds.has(u.id));

    // 5) ширина јединице у пикселима
    function unitWidth(u) {
      return u.members.length === 2 ? NODE_W * 2 + COUPLE_GAP : NODE_W;
    }

    // 6) ширина под-стабла (post-order): шира од сопствене ширине јединице
    //    или збира ширина под-стабала деце (са размацима међу њима).
    //    Ово спречава да, нпр., пар (шири од једног детета) "згњечи" суседну
    //    јединицу — резервише се простор за читаво под-стабло, не само за дете.
    function subtreeWidth(u) {
      if (u._subtreeWidth !== undefined) return u._subtreeWidth;
      const ownW = unitWidth(u);
      if (u.children.length === 0) {
        u._subtreeWidth = ownW;
      } else {
        const childrenW = u.children.reduce((sum, c) => sum + subtreeWidth(c), 0)
          + UNIT_GAP * (u.children.length - 1);
        u._subtreeWidth = Math.max(ownW, childrenW);
      }
      return u._subtreeWidth;
    }
    roots.forEach(subtreeWidth);

    // 7) додела позиција (pre-order): свакој јединици се додели опсег
    //    [left, left + subtreeWidth), а деца се центрирају унутар њега.
    function place(u, left) {
      const sw = subtreeWidth(u);
      if (u.children.length === 0) {
        u.left = left + (sw - unitWidth(u)) / 2;
        u.centerX = u.left + unitWidth(u) / 2;
      } else {
        const childrenW = u.children.reduce((sum, c) => sum + subtreeWidth(c), 0)
          + UNIT_GAP * (u.children.length - 1);
        let childLeft = left + (sw - childrenW) / 2;
        u.children.forEach(c => {
          place(c, childLeft);
          childLeft += subtreeWidth(c) + UNIT_GAP;
        });
        const firstC = u.children[0], lastC = u.children[u.children.length - 1];
        u.centerX = (firstC.centerX + lastC.centerX) / 2;
        u.left = u.centerX - unitWidth(u) / 2;
      }
    }
    let cursor = 0;
    roots.forEach(u => {
      place(u, cursor);
      cursor += subtreeWidth(u) + UNIT_GAP;
    });

    // 7б) поставимо сателитске родитеље тачно изнад свог детета (супротна
    //     страна пара од родитеља-власника), и, ако родитељ-власник нема
    //     других деце осим овог пара, поравнамо и њега изнад свог детета —
    //     тако да оба родитељска пара "гледају" ка пару који их је спојио,
    //     једни лево једни десно, уместо да власник стоји на средини целог
    //     (могуће огромног и неравномерног) под-стабла потомака.
    function memberCenterX(unit, personId) {
      if (unit.members.length === 1) return unit.centerX;
      const idx = unit.members[0].id === personId ? 0 : 1;
      return unit.left + idx * (NODE_W + COUPLE_GAP) + NODE_W / 2;
    }
    satelliteLinks.forEach(link => {
      const canPairBoth = link.ownerUnit && link.ownerUnit.children.length === 1 && link.ownerChildId;
      if (canPairBoth) {
        // обе родитељске јединице центрирамо као групу изнад пара који их је
        // спојио: власник лево или десно (према редоследу чланова пара),
        // сателит на супротној страни, са размаком међу њима да се не преклопе.
        const ownerIsLeftMember = link.childUnit.members[0].id === link.ownerChildId;
        const leftUnit = ownerIsLeftMember ? link.ownerUnit : link.otherUnit;
        const rightUnit = ownerIsLeftMember ? link.otherUnit : link.ownerUnit;
        const combinedW = unitWidth(leftUnit) + UNIT_GAP + unitWidth(rightUnit);
        const groupLeft = link.childUnit.centerX - combinedW / 2;
        leftUnit.left = groupLeft;
        leftUnit.centerX = leftUnit.left + unitWidth(leftUnit) / 2;
        rightUnit.left = groupLeft + unitWidth(leftUnit) + UNIT_GAP;
        rightUnit.centerX = rightUnit.left + unitWidth(rightUnit) / 2;
      } else {
        // власник има и другу децу поред овог пара — не дирамо му позицију
        // (остаје центриран изнад свих својих потомака), само сателит
        // закачимо тачно изнад његовог детета.
        const cx = memberCenterX(link.childUnit, link.otherChildId);
        link.otherUnit.centerX = cx;
        link.otherUnit.left = cx - unitWidth(link.otherUnit) / 2;
      }
    });

    // 7) позиције појединачних особа унутар јединице + линије брака
    const nodes = []; // {person, x, y, w, h}
    const marriageLines = []; // {x1,y1,x2,y2}
    const parentChildPaths = []; // {d}

    units.forEach(u => {
      if (u.members.length === 2) {
        const [a, b] = u.members;
        nodes.push({ person: a, x: u.left, y: u.y, w: NODE_W, h: NODE_H });
        nodes.push({ person: b, x: u.left + NODE_W + COUPLE_GAP, y: u.y, w: NODE_W, h: NODE_H });
        const midY = u.y + NODE_H * 0.42;
        marriageLines.push({
          x1: u.left + NODE_W,
          y1: midY,
          x2: u.left + NODE_W + COUPLE_GAP,
          y2: midY
        });
      } else {
        nodes.push({ person: u.members[0], x: u.left, y: u.y, w: NODE_W, h: NODE_H });
      }
    });

    // линије родитељ→дете цртамо по конкретној особи (не по пару), да би свако
    // од двоје супружника имао своју линију ка својим родитељима, а не да се
    // обе линије споје на средини пара
    const nodeCenterX = new Map();
    const nodeTopY = new Map();
    nodes.forEach(n => {
      nodeCenterX.set(n.person.id, n.x + n.w / 2);
      nodeTopY.set(n.person.id, n.y);
    });

    people.forEach(p => {
      const knownParents = p.parents ? p.parents.filter(pid => byId.has(pid)) : [];
      if (!knownParents.length) return;
      const parentUnit = unitOfPerson.get(knownParents[0]);
      const childX = nodeCenterX.get(p.id);
      const childY = nodeTopY.get(p.id);
      if (!parentUnit || childX === undefined || childY === undefined) return;
      const startX = parentUnit.centerX;
      const startY = parentUnit.members.length === 2
        ? parentUnit.y + NODE_H * 0.42 // средина жуте линије брака
        : parentUnit.y + NODE_H;       // нема супружника → нема жуте линије, остаје испод кутије
      const midY = (startY + childY) / 2;
      const d = `M ${startX} ${startY} C ${startX} ${midY}, ${childX} ${midY}, ${childX} ${childY}`;
      parentChildPaths.push({ d });
    });

    const maxGen = Math.max(...units.map(u => u.gen));
    const totalWidth = cursor - UNIT_GAP;
    const totalHeight = (maxGen + 1) * ROW_HEIGHT;

    return { nodes, marriageLines, parentChildPaths, totalWidth, totalHeight, NODE_W, NODE_H };
  }

  return { buildLayout, NODE_W, NODE_H };
})();

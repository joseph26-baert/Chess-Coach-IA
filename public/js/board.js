// Enveloppe autour de cm-chessboard : échiquier interactif avec coups légaux,
// promotion, dernier coup, échec et cases menacées.
import { Chessboard, INPUT_EVENT_TYPE, COLOR, FEN } from '/vendor/cm-chessboard/src/Chessboard.js';
import { Markers, MARKER_TYPE } from '/vendor/cm-chessboard/src/extensions/markers/Markers.js';
import { PromotionDialog, PROMOTION_DIALOG_RESULT_TYPE } from '/vendor/cm-chessboard/src/extensions/promotion-dialog/PromotionDialog.js';
import { Arrows, ARROW_TYPE } from '/vendor/cm-chessboard/src/extensions/arrows/Arrows.js';
import { Chess } from '/vendor/chess.js/chess.js';

export { Chess, FEN };

// Types de marqueurs propres à l'application (références stables, voir README de l'extension)
const LAST_MOVE = { class: 'marker-last-move', slice: 'markerSquare' };
const CHECK = { class: 'marker-check', slice: 'markerCircleFilled' };
const THREAT = { class: 'marker-threat', slice: 'markerFrame' };
const SELECTED = { class: 'marker-selected', slice: 'markerSquare' };
const ILLEGAL = { class: 'marker-illegal', slice: 'markerSquare' };

let cssLoaded = false;
function ensureCss() {
  if (cssLoaded) return;
  cssLoaded = true;
  for (const href of ['/vendor/cm-chessboard/assets/chessboard.css',
                      '/vendor/cm-chessboard/assets/extensions/markers/markers.css',
                      '/vendor/cm-chessboard/assets/extensions/promotion-dialog/promotion-dialog.css',
                      '/vendor/cm-chessboard/assets/extensions/arrows/arrows.css']) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    document.head.appendChild(l);
  }
}

/**
 * createBoard(element, options)
 *  options.fen          position initiale
 *  options.orientation  'white' | 'black'
 *  options.onMove       async ({from, to, promotion}) => boolean   (coup du joueur, validé côté client puis serveur)
 */
export function createBoard(el, { fen = FEN.start, orientation = 'white', onMove = null } = {}) {
  ensureCss();
  const chess = new Chess(fen);
  el.classList.add('board-locked');
  const board = new Chessboard(el, {
    position: fen,
    orientation: orientation === 'white' ? COLOR.white : COLOR.black,
    assetsUrl: '/vendor/cm-chessboard/assets/',
    style: { cssClass: 'coach', showCoordinates: true, animationDuration: 220, pieces: { file: '/pieces/coach.svg' } },
    extensions: [{ class: Markers, props: { autoMarkers: null } }, { class: PromotionDialog }, { class: Arrows }],
  });

  let inputColor = null;
  let inputEnabled = false;
  let threatsOn = false;

  function playerColorChar() { return inputColor === 'white' ? 'w' : 'b'; }

  function inputHandler(event) {
    switch (event.type) {
      case INPUT_EVENT_TYPE.moveInputStarted: {
        const piece = chess.get(event.squareFrom);
        if (!piece || piece.color !== playerColorChar() || chess.turn() !== playerColorChar()) return false;
        board.removeMarkers(SELECTED);
        board.addMarker(SELECTED, event.squareFrom);
        board.addLegalMovesMarkers(chess.moves({ square: event.squareFrom, verbose: true }));
        return true;
      }
      case INPUT_EVENT_TYPE.validateMoveInput: {
        const legal = chess.moves({ square: event.squareFrom, verbose: true }).filter(m => m.to === event.squareTo);
        if (!legal.length) {
          // Case non jouable : la pièce reste à sa place, la case visée clignote brièvement en rouge
          if (event.squareTo && event.squareTo !== event.squareFrom && !chess.get(event.squareTo)?.color?.includes(playerColorChar())) {
            board.addMarker(ILLEGAL, event.squareTo);
            setTimeout(() => { try { board.removeMarkers(ILLEGAL, event.squareTo); } catch { /* échiquier détruit */ } }, 350);
          }
          return false;
        }
        const needsPromotion = legal.some(m => m.promotion);
        board.removeLegalMovesMarkers();
        board.removeMarkers(SELECTED);
        if (needsPromotion) {
          board.showPromotionDialog(event.squareTo, playerColorChar() === 'w' ? COLOR.white : COLOR.black, async (res) => {
            if (res.type === PROMOTION_DIALOG_RESULT_TYPE.pieceSelected) {
              const promotion = res.piece[1]; // 'wq' -> 'q'
              await submit(event.squareFrom, event.squareTo, promotion);
            } else {
              board.setPosition(chess.fen(), true);
            }
          });
          return true;
        }
        // On applique localement tout de suite (fluidité), le serveur confirme ensuite
        submit(event.squareFrom, event.squareTo, undefined);
        return true;
      }
      case INPUT_EVENT_TYPE.moveInputCanceled:
        board.removeLegalMovesMarkers();
        board.removeMarkers(SELECTED);
        return true;
      default:
        return true;
    }
  }

  async function submit(from, to, promotion) {
    const ok = onMove ? await onMove({ from, to, promotion }) : true;
    if (!ok) await board.setPosition(chess.fen(), true);
  }

  function refreshMarkers() {
    board.removeMarkers(CHECK);
    board.removeMarkers(THREAT);
    if (chess.isCheck()) {
      const kingSquare = findKing(chess, chess.turn());
      if (kingSquare) board.addMarker(CHECK, kingSquare);
    }
    if (threatsOn && inputColor) {
      for (const sq of threatenedSquares(chess, playerColorChar())) board.addMarker(THREAT, sq);
    }
  }

  const api = {
    chess,
    board,
    async setPosition(newFen, animated = true) {
      chess.load(newFen);
      await board.setPosition(newFen, animated);
      refreshMarkers();
    },
    setLastMove(from, to) {
      board.removeMarkers(LAST_MOVE);
      if (from && to) { board.addMarker(LAST_MOVE, from); board.addMarker(LAST_MOVE, to); }
    },
    enableInput(color) {
      if (inputEnabled) board.disableMoveInput();
      el.classList.remove('board-locked');
      inputColor = color;
      board.enableMoveInput(inputHandler, color === 'white' ? COLOR.white : COLOR.black);
      inputEnabled = true;
      refreshMarkers();
    },
    disableInput() {
      inputColor = null;
      el.classList.add('board-locked'); // aucun toucher accepté tant que ce n'est pas au joueur
      if (inputEnabled) board.disableMoveInput();
      inputEnabled = false;
      board.removeLegalMovesMarkers();
      board.removeMarkers(SELECTED);
    },
    setThreats(on) { threatsOn = on; refreshMarkers(); },
    // Flèche (ex. meilleur coup) : type 'best' | 'played'
    setArrows(list) {
      board.removeArrows();
      for (const a of list) if (a.from && a.to) board.addArrow(a.type === 'best' ? ARROW_TYPE.success : ARROW_TYPE.danger, a.from, a.to);
    },
    clearArrows() { board.removeArrows(); },
    setOrientation(color) { return board.setOrientation(color === 'white' ? COLOR.white : COLOR.black); },
    destroy() { board.destroy(); },
  };
  refreshMarkers();
  return api;
}

function findKing(chess, color) {
  for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}

// Pièces du joueur attaquées par l'adversaire
function threatenedSquares(chess, color) {
  const enemy = color === 'w' ? 'b' : 'w';
  const out = [];
  for (const row of chess.board()) for (const p of row) {
    if (p && p.color === color && p.type !== 'k' && chess.isAttacked(p.square, enemy)) out.push(p.square);
  }
  return out;
}

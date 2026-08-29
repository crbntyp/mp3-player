// Vinyl record slide + spin animation state machine.
//
// Owns the visibility/sliding state for the record element. The player still
// initiates animations (during play/pause/track changes), but the bookkeeping
// of "is it visible, is it sliding, should it spin" lives here.

export class RecordAnimator {
  constructor(player) {
    this.player = player;
    this.element = document.getElementById('rotate-record');
    this.visible = false;
    this.sliding = false;
  }

  // Toggle the spinning CSS class. Only spins when the player is playing AND
  // we're not mid-slide — spinning during a slide reads as jittery.
  updateRotation() {
    if (!this.element) return;
    if (this.player.isPlaying && !this.sliding) {
      this.element.classList.add('playing');
    } else {
      this.element.classList.remove('playing');
    }
  }

  slideOut() {
    return new Promise((resolve) => {
      if (!this.element) {
        resolve();
        return;
      }

      this.sliding = true;
      this.visible = true;

      this.element.classList.remove('slide-in', 'hidden', 'playing');
      this.element.classList.add('slide-out');

      // Safety net. Animations do not run on a hidden page, so animationend
      // can simply never arrive — and anything awaiting this would wait
      // forever. Nothing should be able to wedge on decoration.
      let settled = false;
      const onEnd = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.element.removeEventListener('animationend', onEnd);
        this.element.classList.remove('slide-out');
        this.element.classList.add('visible');
        this.sliding = false;

        if (this.player.isPlaying) {
          this.updateRotation();
        }
        resolve();
      };
      this.element.addEventListener('animationend', onEnd);
      const timer = setTimeout(onEnd, 1500);
    });
  }

  slideIn() {
    return new Promise((resolve) => {
      if (!this.element) {
        resolve();
        return;
      }

      this.sliding = true;
      this.element.classList.remove('playing', 'visible', 'slide-out');
      this.element.classList.add('slide-in');

      // Safety net. Animations do not run on a hidden page, so animationend
      // can simply never arrive — and anything awaiting this would wait
      // forever. Nothing should be able to wedge on decoration.
      let settled = false;
      const onEnd = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.element.removeEventListener('animationend', onEnd);
        this.element.classList.remove('slide-in');
        this.element.classList.add('hidden');
        this.visible = false;
        this.sliding = false;
        resolve();
      };
      this.element.addEventListener('animationend', onEnd);
      const timer = setTimeout(onEnd, 1500);
    });
  }
}

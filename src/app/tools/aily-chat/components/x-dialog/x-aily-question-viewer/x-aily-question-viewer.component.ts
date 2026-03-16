import { Component, Input, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface OptionItem {
  label: string;
  description?: string;
  recommended?: boolean;
}

interface QuestionItem {
  question: string;
  options: OptionItem[];
  multi_select: boolean;
  allow_freeform: boolean;
}

interface AnswerRecord {
  selected: Set<number>;
  freeform: string;
}

@Component({
  selector: 'x-aily-question-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (questions.length > 0) {
      <div class="aq-container" [class.aq-all-done]="allDone">
        <!-- Header -->
        <div class="aq-header">
          <div class="aq-question">{{ currentQ.question }}</div>
          @if (questions.length > 1) {
            <div class="aq-progress">
              <span class="aq-progress-current">{{ currentIndex + 1 }}</span>
              <span class="aq-progress-sep">/</span>
              <span class="aq-progress-total">{{ questions.length }}</span>
            </div>
          }
        </div>

        <!-- Options -->
        @if (currentQ.options.length > 0) {
          <div class="aq-options">
            @for (opt of currentQ.options; track $index) {
              <label class="aq-option"
                [class.aq-checked]="isOptionSelected($index)"
                [class.aq-disabled]="allDone || isHistory">
                <span class="aq-indicator"
                  [class.aq-indicator-radio]="!currentQ.multi_select"
                  [class.aq-indicator-checked]="isOptionSelected($index)">
                  @if (isOptionSelected($index) && currentQ.multi_select) {
                    <i class="fa-solid fa-check"></i>
                  }
                  @if (isOptionSelected($index) && !currentQ.multi_select) {
                    <span class="aq-radio-dot"></span>
                  }
                </span>
                <span class="aq-option-body">
                  <span class="aq-option-label">{{ opt.label }}</span>
                  @if (opt.description) {
                    <span class="aq-option-desc">{{ opt.description }}</span>
                  }
                </span>
                <input type="checkbox" class="aq-hidden-input"
                  [checked]="isOptionSelected($index)"
                  [disabled]="allDone || isHistory"
                  (change)="toggleOption($index)" />
              </label>
            }
          </div>
        }

        <!-- Freeform input -->
        @if (currentQ.allow_freeform) {
          <div class="aq-freeform" [class.aq-freeform-only]="currentQ.options.length === 0">
            <input
              class="aq-freeform-input"
              type="text"
              placeholder="输入您的回答..."
              [ngModel]="currentAnswer.freeform"
              (ngModelChange)="onFreeformChange($event)"
              [disabled]="allDone || isHistory"
              (keydown.enter)="onConfirm()" />
          </div>
        }

        <!-- Actions -->
        @if (!allDone && !isHistory) {
          <div class="aq-actions">
            @if (currentIndex > 0) {
              <button class="aq-btn aq-btn-ghost" (click)="goPrev()">
                <i class="fa-light fa-chevron-left"></i> 返回
              </button>
            }
            <div class="aq-actions-spacer"></div>
            <button class="aq-btn aq-btn-primary"
              [disabled]="!hasCurrentSelection"
              (click)="onConfirm()">
              {{ isLastQuestion ? '确认提交' : '确认' }}
            </button>
          </div>
        }

        <!-- All done result -->
        @if (allDone && !isHistory) {
          <div class="aq-done-bar">
            <i class="fa-solid fa-circle-check"></i>
            <span>{{ submittedSummary }}</span>
          </div>
        }
        @if (allDone && isHistory) {
          <div class="aq-done-bar">
            <i class="fa-solid fa-circle-check"></i>
            <span>已回答</span>
          </div>
        }

        <!-- Progress dots -->
        @if (questions.length > 1 && !allDone) {
          <div class="aq-dots">
            @for (q of questions; track $index) {
              <span class="aq-dot"
                [class.aq-dot-active]="$index === currentIndex"
                [class.aq-dot-done]="answeredSet.has($index) && $index !== currentIndex">
              </span>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .aq-container {
      border-radius: 10px;
      padding: 16px;
      margin: 0;
      background: #1e1e1e;
      border: 1px solid #333;
      transition: border-color 0.2s;
    }
    .aq-container:not(.aq-all-done):hover { border-color: #444; }
    .aq-all-done { opacity: 0.72; }

    /* Header */
    .aq-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .aq-question {
      font-size: 13px;
      font-weight: 500;
      color: #d4d4d4;
      line-height: 1.5;
      flex: 1;
    }
    .aq-progress {
      flex-shrink: 0;
      font-size: 12px;
      font-weight: 600;
      color: #666;
      background: #2a2a2a;
      border-radius: 10px;
      padding: 2px 10px;
      line-height: 1.6;
      white-space: nowrap;
    }
    .aq-progress-current { color: #1890ff; }
    .aq-progress-sep { color: #555; margin: 0 1px; }
    .aq-progress-total { color: #888; }

    /* Options */
    .aq-options { display: flex; flex-direction: column; gap: 6px; }
    .aq-option {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;
      background: #252526;
      border: 1px solid #333;
      transition: all 0.15s ease;
      user-select: none;
    }
    .aq-option:hover:not(.aq-disabled) { background: #2a2d2e; border-color: #444; }
    .aq-option.aq-checked:not(.aq-disabled) {
      background: rgba(24, 144, 255, 0.08);
      border-color: rgba(24, 144, 255, 0.4);
    }
    .aq-option.aq-disabled { cursor: default; opacity: 0.6; }

    /* Checkbox / Radio indicator */
    .aq-indicator {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      border: 1.5px solid #555;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-top: 1px;
      transition: all 0.15s ease;
      font-size: 10px;
      color: transparent;
      background: transparent;
    }
    .aq-indicator-radio { border-radius: 50%; }
    .aq-indicator-checked {
      background: #1890ff;
      border-color: #1890ff;
      color: #fff;
    }
    .aq-radio-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #fff;
    }

    /* Option body (label + description) */
    .aq-option-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }
    .aq-option-label {
      font-size: 13px;
      color: #ccc;
      line-height: 1.4;
    }
    .aq-option-desc {
      font-size: 11px;
      color: #777;
      line-height: 1.3;
    }

    .aq-hidden-input {
      position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none;
    }

    /* Freeform */
    .aq-freeform { margin-top: 10px; }
    .aq-freeform-only { margin-top: 0; }
    .aq-freeform-input {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid #333;
      background: #252526;
      color: #d4d4d4;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }
    .aq-freeform-input:focus { border-color: #1890ff; }
    .aq-freeform-input:disabled { opacity: 0.5; cursor: not-allowed; }
    .aq-freeform-input::placeholder { color: #666; }

    /* Actions */
    .aq-actions {
      margin-top: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .aq-actions-spacer { flex: 1; }
    .aq-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      outline: none;
      transition: all 0.2s ease;
    }
    .aq-btn-primary { background: #1890ff; color: #fff; }
    .aq-btn-primary:hover:not(:disabled) { background: #40a9ff; }
    .aq-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .aq-btn-ghost {
      background: transparent;
      color: #999;
      padding: 6px 10px;
    }
    .aq-btn-ghost:hover { color: #ccc; background: rgba(255,255,255,.05); }

    /* Done bar */
    .aq-done-bar {
      margin-top: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #52c41a;
    }
    .aq-done-bar i { font-size: 13px; }
    .aq-done-bar span { color: #888; }

    /* Progress dots */
    .aq-dots {
      display: flex;
      justify-content: center;
      gap: 6px;
      margin-top: 14px;
    }
    .aq-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #444;
      transition: all 0.2s ease;
    }
    .aq-dot-active { background: #1890ff; transform: scale(1.3); }
    .aq-dot-done { background: #52c41a; }
  `],
})
export class XAilyQuestionViewerComponent implements OnChanges {
  @Input() data: any = null;
  @Input() streamStatus: string = 'done';

  questions: QuestionItem[] = [];
  currentIndex = 0;
  isHistory = false;
  allDone = false;
  submittedSummary = '';

  answers = new Map<number, AnswerRecord>();
  answeredSet = new Set<number>();

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data']) this.processData();
  }

  // ===== Getters =====

  get currentQ(): QuestionItem {
    return this.questions[this.currentIndex];
  }

  get currentAnswer(): AnswerRecord {
    if (!this.answers.has(this.currentIndex)) {
      this.answers.set(this.currentIndex, { selected: new Set(), freeform: '' });
    }
    return this.answers.get(this.currentIndex)!;
  }

  get hasCurrentSelection(): boolean {
    return this.currentAnswer.selected.size > 0 || this.currentAnswer.freeform.trim().length > 0;
  }

  get isLastQuestion(): boolean {
    return this.currentIndex === this.questions.length - 1;
  }

  isOptionSelected(idx: number): boolean {
    return this.currentAnswer.selected.has(idx);
  }

  // ===== Actions =====

  toggleOption(index: number): void {
    if (this.allDone || this.isHistory) return;
    const ans = this.currentAnswer;
    if (this.currentQ.multi_select) {
      if (ans.selected.has(index)) {
        ans.selected.delete(index);
      } else {
        ans.selected.add(index);
      }
    } else {
      ans.selected.clear();
      ans.selected.add(index);
    }
    this.cdr.markForCheck();
  }

  onFreeformChange(value: string): void {
    this.currentAnswer.freeform = value;
    this.cdr.markForCheck();
  }

  onConfirm(): void {
    if (this.allDone || !this.hasCurrentSelection) return;
    this.answeredSet.add(this.currentIndex);

    if (this.isLastQuestion) {
      this.submitAll();
    } else {
      this.currentIndex++;
      this.initRecommended(this.currentIndex);
      this.cdr.markForCheck();
    }
  }

  goPrev(): void {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.cdr.markForCheck();
    }
  }

  // ===== Submit =====

  private submitAll(): void {
    this.allDone = true;

    const answersMap: Record<string, { selected: string[]; freeText: string | null; skipped: boolean }> = {};
    const summaryParts: string[] = [];

    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i];
      const ans = this.answers.get(i);
      if (!ans) {
        answersMap[q.question] = { selected: [], freeText: null, skipped: true };
        continue;
      }

      const selectedLabels = Array.from(ans.selected)
        .sort((a, b) => a - b)
        .map(idx => q.options[idx]?.label)
        .filter(Boolean);

      const freeText = ans.freeform.trim() || null;

      answersMap[q.question] = {
        selected: selectedLabels,
        freeText,
        skipped: selectedLabels.length === 0 && !freeText,
      };

      const displayParts = [...selectedLabels];
      if (freeText) displayParts.push(freeText);
      if (displayParts.length > 0) summaryParts.push(displayParts.join(', '));
    }

    this.submittedSummary = summaryParts.length > 0
      ? '已提交: ' + summaryParts.join(' | ')
      : '已提交';
    this.cdr.markForCheck();

    document.dispatchEvent(new CustomEvent('aily-question-answer', {
      bubbles: true,
      detail: { answers: answersMap },
    }));
  }

  // ===== Data processing =====

  private processData(): void {
    if (!this.data) {
      if (this.streamStatus === 'done') this.questions = [];
      return;
    }
    try {
      let rawQuestions: any[];

      if (this.data.questions && Array.isArray(this.data.questions)) {
        rawQuestions = this.data.questions;
      } else if (Array.isArray(this.data)) {
        rawQuestions = this.data;
      } else if (this.data.question) {
        rawQuestions = [this.data];
      } else {
        this.questions = [];
        return;
      }

      this.isHistory = this.data.isHistory === true;
      this.questions = rawQuestions
        .filter((d: any) => d.question && typeof d.question === 'string')
        .map((d: any) => this.normalizeQuestion(d));

      if (this.questions.length === 0) return;

      this.currentIndex = 0;
      this.answers.clear();
      this.answeredSet.clear();
      this.allDone = false;
      this.submittedSummary = '';

      if (this.isHistory) {
        this.allDone = true;
      } else {
        this.initRecommended(0);
      }
    } catch {
      this.questions = [];
    }
  }

  private normalizeQuestion(d: any): QuestionItem {
    let options: OptionItem[] = [];

    if (Array.isArray(d.options)) {
      options = d.options.map((o: any) => this.normalizeOption(o));
    } else if (Array.isArray(d.choices)) {
      options = d.choices.map((c: any) => this.normalizeOption(c));
    }

    return {
      question: d.question,
      options,
      multi_select: d.multi_select ?? false,
      allow_freeform: d.allow_freeform ?? d.allowFreeform ?? (options.length === 0),
    };
  }

  private normalizeOption(o: any): OptionItem {
    if (typeof o === 'string') return { label: o };
    return {
      label: o.label ?? o.text ?? String(o),
      description: o.description,
      recommended: o.recommended ?? false,
    };
  }

  private initRecommended(qIndex: number): void {
    if (this.answers.has(qIndex)) return;
    const q = this.questions[qIndex];
    if (!q) return;
    const ans: AnswerRecord = { selected: new Set(), freeform: '' };
    q.options.forEach((o, i) => {
      if (o.recommended) ans.selected.add(i);
    });
    this.answers.set(qIndex, ans);
  }
}

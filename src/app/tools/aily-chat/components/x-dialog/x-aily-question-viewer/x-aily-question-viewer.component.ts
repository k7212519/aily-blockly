import { Component, Input, OnChanges, SimpleChanges, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../../services/chat.service';

interface QuestionData {
  question: string;
  choices: string[];
  allowFreeform?: boolean;
  isHistory?: boolean;
}

@Component({
  selector: 'x-aily-question-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (questionData) {
      <div class="aq-container" [class.aq-submitted]="submitted">
        <div class="aq-question">{{ questionData.question }}</div>

        <div class="aq-choices">
          @for (choice of questionData.choices; track $index) {
            <label class="aq-choice" [class.aq-checked]="selectedSet.has($index)" [class.aq-disabled]="submitted">
              <span class="aq-checkbox" [class.aq-checkbox-checked]="selectedSet.has($index)">
                @if (selectedSet.has($index)) {
                  <i class="fa-solid fa-check"></i>
                }
              </span>
              <span class="aq-choice-text">{{ choice }}</span>
              <input type="checkbox" class="aq-hidden-input"
                [checked]="selectedSet.has($index)"
                [disabled]="submitted"
                (change)="toggleChoice($index)" />
            </label>
          }
        </div>

        @if (questionData.allowFreeform) {
          <div class="aq-freeform">
            <input
              class="aq-freeform-input"
              type="text"
              placeholder="自定义输入..."
              [(ngModel)]="freeformText"
              [disabled]="submitted"
              (keydown.enter)="onSubmit()" />
          </div>
        }

        @if (!submitted && !questionData.isHistory) {
          <div class="aq-actions">
            <button class="aq-btn aq-btn-primary" [disabled]="!hasSelection" (click)="onSubmit()">确认</button>
          </div>
        }

        @if (submitted) {
          <div class="aq-result">
            <i class="fa-solid fa-check"></i>
            <span>{{ submittedText }}</span>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .aq-container {
      border-radius: 10px;
      padding: 16px;
      margin: 8px 0;
      background: #1e1e1e;
      border: 1px solid #333;
      transition: border-color 0.2s;
    }
    .aq-container:not(.aq-submitted):hover {
      border-color: #444;
    }
    .aq-submitted {
      opacity: 0.75;
    }

    .aq-question {
      font-size: 13px;
      font-weight: 500;
      color: #d4d4d4;
      margin-bottom: 14px;
      line-height: 1.5;
    }

    .aq-choices {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .aq-choice {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 8px;
      cursor: pointer;
      background: #252526;
      border: 1px solid #333;
      transition: all 0.15s ease;
      user-select: none;
    }
    .aq-choice:hover:not(.aq-disabled) {
      background: #2a2d2e;
      border-color: #444;
    }
    .aq-choice.aq-checked:not(.aq-disabled) {
      background: rgba(24, 144, 255, 0.08);
      border-color: rgba(24, 144, 255, 0.4);
    }
    .aq-choice.aq-disabled {
      cursor: default;
      opacity: 0.6;
    }

    .aq-checkbox {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      border: 1.5px solid #555;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.15s ease;
      font-size: 10px;
      color: transparent;
      background: transparent;
    }
    .aq-checkbox-checked {
      background: #1890ff;
      border-color: #1890ff;
      color: #fff;
    }

    .aq-choice-text {
      font-size: 13px;
      color: #ccc;
      line-height: 1.4;
    }

    .aq-hidden-input {
      position: absolute;
      opacity: 0;
      width: 0;
      height: 0;
      pointer-events: none;
    }

    .aq-freeform {
      margin-top: 10px;
    }
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
    .aq-freeform-input:focus {
      border-color: #1890ff;
    }
    .aq-freeform-input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .aq-freeform-input::placeholder {
      color: #666;
    }

    .aq-actions {
      margin-top: 14px;
      display: flex;
      justify-content: flex-end;
    }
    .aq-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 18px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      outline: none;
      transition: all 0.2s ease;
    }
    .aq-btn-primary {
      background: #1890ff;
      color: #fff;
    }
    .aq-btn-primary:hover:not(:disabled) {
      background: #40a9ff;
    }
    .aq-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .aq-result {
      margin-top: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #52c41a;
    }
    .aq-result i {
      font-size: 11px;
    }
    .aq-result span {
      color: #888;
    }
  `],
})
export class XAilyQuestionViewerComponent implements OnChanges {
  @Input() data: any = null;
  @Input() streamStatus: string = 'done';

  questionData: QuestionData | null = null;
  selectedSet = new Set<number>();
  freeformText = '';
  submitted = false;
  submittedText = '';

  constructor(
    private chatService: ChatService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data']) this.processData();
  }

  get hasSelection(): boolean {
    return this.selectedSet.size > 0 || this.freeformText.trim().length > 0;
  }

  toggleChoice(index: number): void {
    if (this.submitted) return;
    if (this.selectedSet.has(index)) {
      this.selectedSet.delete(index);
    } else {
      this.selectedSet.add(index);
    }
    this.cdr.markForCheck();
  }

  onSubmit(): void {
    if (this.submitted || !this.hasSelection || !this.questionData) return;
    this.submitted = true;

    const selected = Array.from(this.selectedSet)
      .sort((a, b) => a - b)
      .map(i => this.questionData!.choices[i]);

    if (this.freeformText.trim()) {
      selected.push(this.freeformText.trim());
    }

    this.submittedText = '已选择: ' + selected.join(', ');
    this.cdr.markForCheck();

    const replyText = selected.join('\n');
    // TODO @i3water 确认后处理逻辑
    this.chatService.sendTextToChat(replyText, {
      sender: 'question',
      type: 'question-answer',
      cover: false,
    });
  }

  private processData(): void {
    if (!this.data) {
      if (this.streamStatus === 'done') this.questionData = null;
      return;
    }
    try {
      const d = this.data;
      if (d.question && Array.isArray(d.choices)) {
        this.questionData = {
          question: d.question,
          choices: d.choices,
          allowFreeform: d.allowFreeform ?? false,
          isHistory: d.isHistory ?? false,
        };
        if (this.questionData.isHistory) {
          this.submitted = true;
          this.submittedText = '已回答';
        }
      } else {
        this.questionData = null;
      }
    } catch {
      this.questionData = null;
    }
  }
}

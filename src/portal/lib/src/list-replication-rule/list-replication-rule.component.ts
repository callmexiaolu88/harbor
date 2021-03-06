// Copyright (c) 2017 VMware, Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import {
    Component,
    Input,
    Output,
    OnInit,
    EventEmitter,
    ViewChild,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    OnChanges,
    SimpleChange,
    SimpleChanges
} from "@angular/core";
import { forkJoin} from "rxjs";
import { Comparator } from "@clr/angular";
import { TranslateService } from "@ngx-translate/core";

import {ReplicationService} from "../service/replication.service";
import {
    ReplicationJob,
    ReplicationJobItem,
    ReplicationRule
} from "../service/interface";
import {ConfirmationDialogComponent} from "../confirmation-dialog/confirmation-dialog.component";
import {ConfirmationMessage} from "../confirmation-dialog/confirmation-message";
import {ConfirmationAcknowledgement} from "../confirmation-dialog/confirmation-state-message";
import {
    ConfirmationState,
    ConfirmationTargets,
    ConfirmationButtons
} from "../shared/shared.const";
import {ErrorHandler} from "../error-handler/error-handler";
import {toPromise, CustomComparator} from "../utils";
import {operateChanges, OperateInfo, OperationState} from "../operation/operate";
import {OperationService} from "../operation/operation.service";


@Component({
    selector: "hbr-list-replication-rule",
    templateUrl: "./list-replication-rule.component.html",
    styleUrls: ["./list-replication-rule.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ListReplicationRuleComponent implements OnInit, OnChanges {
    nullTime = "0001-01-01T00:00:00Z";

    @Input() projectId: number;
    @Input() isSystemAdmin: boolean;
    @Input() selectedId: number | string;
    @Input() withReplicationJob: boolean;

    @Input() loading = false;

    @Output() reload = new EventEmitter<boolean>();
    @Output() selectOne = new EventEmitter<ReplicationRule>();
    @Output() editOne = new EventEmitter<ReplicationRule>();
    @Output() toggleOne = new EventEmitter<ReplicationRule>();
    @Output() hideJobs = new EventEmitter<any>();
    @Output() redirect = new EventEmitter<ReplicationRule>();
    @Output() openNewRule = new EventEmitter<any>();
    @Output() replicateManual = new EventEmitter<ReplicationRule>();

    projectScope = false;

    rules: ReplicationRule[];
    changedRules: ReplicationRule[];
    ruleName: string;
    canDeleteRule: boolean;

    selectedRow: ReplicationRule;

    @ViewChild("toggleConfirmDialog")
    toggleConfirmDialog: ConfirmationDialogComponent;

    @ViewChild("deletionConfirmDialog")
    deletionConfirmDialog: ConfirmationDialogComponent;

    startTimeComparator: Comparator<ReplicationRule> = new CustomComparator<ReplicationRule>("start_time", "date");
    enabledComparator: Comparator<ReplicationRule> = new CustomComparator<ReplicationRule>("enabled", "number");

    constructor(private replicationService: ReplicationService,
                private translateService: TranslateService,
                private errorHandler: ErrorHandler,
                private operationService: OperationService,
                private ref: ChangeDetectorRef) {
        setInterval(() => ref.markForCheck(), 500);
    }

    trancatedDescription(desc: string): string {
        if (desc.length > 35) {
            return desc.substr(0, 35);
        } else {
            return desc;
        }
    }

    ngOnInit(): void {
        // Global scope
        if (!this.projectScope) {
            this.retrieveRules();
        }
    }

    ngOnChanges(changes: SimpleChanges): void {
        let proIdChange: SimpleChange = changes["projectId"];
        if (proIdChange) {
            if (proIdChange.currentValue !== proIdChange.previousValue) {
                if (proIdChange.currentValue) {
                    this.projectId = proIdChange.currentValue;
                    this.projectScope = true; // Scope is project, not global list
                    // Initially load the replication rule data
                    this.retrieveRules();
                }
            }
        }
    }

    retrieveRules(ruleName = ""): void {
        this.loading = true;
        /*this.selectedRow = null;*/
        toPromise<ReplicationRule[]>(
            this.replicationService.getReplicationRules(this.projectId, ruleName)
        )
            .then(rules => {
                this.rules = rules || [];
                // job list hidden
                this.hideJobs.emit();
                this.changedRules = this.rules;
                this.loading = false;
            })
            .catch(error => {
                this.errorHandler.error(error);
                this.loading = false;
            });
    }

    replicateRule(rule: ReplicationRule): void {
        this.replicateManual.emit(rule);
    }

    hasDeletedLabel(rule: any) {
        if (rule.filters) {
            let count = 0;
            rule.filters.forEach((data: any) => {
                if (data.kind === 'label' && data.value.deleted) {
                    count ++;
                }
            });
            if (count === 0) {
                return 'enabled';
            } else { return 'disabled'; }
        }
        return 'enabled';
    }

    deletionConfirm(message: ConfirmationAcknowledgement) {
        if (
            message &&
            message.source === ConfirmationTargets.POLICY &&
            message.state === ConfirmationState.CONFIRMED
        ) {
            this.deleteOpe(message.data);
        }
    }

    selectRule(rule: ReplicationRule): void {
        this.selectedId = rule.id || "";
        this.selectOne.emit(rule);
    }

    redirectTo(rule: ReplicationRule): void {
        this.redirect.emit(rule);
    }

    openModal(): void {
        this.openNewRule.emit();
    }

    editRule(rule: ReplicationRule) {
        this.editOne.emit(rule);
    }

    jobList(id: string | number): Promise<void> {
        let ruleData: ReplicationJobItem[];
        this.canDeleteRule = true;
        let count = 0;
        return toPromise<ReplicationJob>(this.replicationService.getJobs(id))
            .then(response => {
                ruleData = response.data;
                if (ruleData.length) {
                    ruleData.forEach(job => {
                        if (
                            job.status === "pending" ||
                            job.status === "running" ||
                            job.status === "retrying"
                        ) {
                            count++;
                        }
                    });
                }
                this.canDeleteRule = count > 0 ? false : true;
            })
            .catch(error => this.errorHandler.error(error));
    }

    deleteRule(rule: ReplicationRule) {
        if (rule) {
            let deletionMessage = new ConfirmationMessage(
                "REPLICATION.DELETION_TITLE",
                "REPLICATION.DELETION_SUMMARY",
                rule.name,
                rule,
                ConfirmationTargets.POLICY,
                ConfirmationButtons.DELETE_CANCEL
            );
            this.deletionConfirmDialog.open(deletionMessage);
        }
    }

    deleteOpe(rule: ReplicationRule) {
        if (rule) {
            let promiseLists: any[] = [];
            Promise.all([this.jobList(rule.id)]).then(items => {
                promiseLists.push(this.delOperate(rule));

                Promise.all(promiseLists).then(item => {
                    this.selectedRow = null;
                    this.reload.emit(true);
                    let hnd = setInterval(() => this.ref.markForCheck(), 200);
                    setTimeout(() => clearInterval(hnd), 2000);
                });
            });
        }
    }

    delOperate(rule: ReplicationRule) {
        // init operation info
        let operMessage = new OperateInfo();
        operMessage.name = 'OPERATION.DELETE_REPLICATION';
        operMessage.data.id = +rule.id;
        operMessage.state = OperationState.progressing;
        operMessage.data.name = rule.name;
        this.operationService.publishInfo(operMessage);

        if (!this.canDeleteRule) {
            forkJoin(this.translateService.get('BATCH.DELETED_FAILURE'),
                this.translateService.get('REPLICATION.DELETION_SUMMARY_FAILURE')).subscribe(res => {
                operateChanges(operMessage, OperationState.failure, res[1]);
            });
            return null;
        }

        return toPromise<any>(this.replicationService
            .deleteReplicationRule(+rule.id))
            .then(() => {
                this.translateService.get('BATCH.DELETED_SUCCESS')
                    .subscribe(res => operateChanges(operMessage, OperationState.success));
            })
            .catch(error => {
                if (error && error.status === 412) {
                    forkJoin(this.translateService.get('BATCH.DELETED_FAILURE'),
                        this.translateService.get('REPLICATION.FAILED_TO_DELETE_POLICY_ENABLED')).subscribe(res => {
                        operateChanges(operMessage, OperationState.failure, res[1]);
                    });
                } else {
                    this.translateService.get('BATCH.DELETED_FAILURE').subscribe(res => {
                        operateChanges(operMessage, OperationState.failure, res);
                    });
                }
            });
    }
}

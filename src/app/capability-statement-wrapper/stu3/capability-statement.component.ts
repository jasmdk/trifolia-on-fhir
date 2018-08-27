import {Component, DoCheck, Input, OnInit} from '@angular/core';
import {CapabilityStatementService} from '../../services/capability-statement.service';
import {ActivatedRoute, Router} from '@angular/router';
import {CapabilityStatement, EventComponent, ResourceComponent, RestComponent} from '../../models/stu3/fhir';
import {Globals} from '../../globals';
import {Observable} from 'rxjs/Observable';
import {RecentItemService} from '../../services/recent-item.service';
import {FhirService} from '../../services/fhir.service';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {FhirEditCapabilityStatementResourceModalComponent} from '../../fhir-edit/capability-statement-resource-modal/capability-statement-resource-modal.component';
import {FhirEditMessagingEventModalComponent} from '../../fhir-edit/messaging-event-modal/messaging-event-modal.component';
import {FhirEditReferenceModalComponent} from '../../fhir-edit/reference-modal/reference-modal.component';
import {ConfigService} from '../../services/config.service';
import {FileService} from '../../services/file.service';

@Component({
    selector: 'app-capability-statement',
    templateUrl: './capability-statement.component.html',
    styleUrls: ['./capability-statement.component.css']
})
export class CapabilityStatementComponent implements OnInit, DoCheck {
    @Input() public capabilityStatement = new CapabilityStatement();
    public message: string;
    public validation: any;

    constructor(
        public globals: Globals,
        public fhirService: FhirService,
        public fileService: FileService,
        private modalService: NgbModal,
        private csService: CapabilityStatementService,
        private configService: ConfigService,
        private route: ActivatedRoute,
        private router: Router,
        private recentItemService: RecentItemService) {

    }

    public save() {
        const capabilityStatementId  = this.route.snapshot.paramMap.get('id');

        if (!this.validation.valid && !confirm('This capability statement is not valid, are you sure you want to save?')) {
            return;
        }

        if (capabilityStatementId === 'from-file') {
            this.fileService.saveFile();
            return;
        }

        this.csService.save(this.capabilityStatement)
            .subscribe((results: CapabilityStatement) => {
                if (!this.capabilityStatement.id) {
                    this.router.navigate(['/capability-statement/' + results.id]);
                } else {
                    this.recentItemService.ensureRecentItem(this.globals.cookieKeys.recentCapabilityStatements, results.id, results.name);
                    this.message = 'Successfully saved capability statement!';
                    setTimeout(() => { this.message = ''; }, 3000);
                }
            }, (err) => {
                this.message = 'An error occured while saving the capability statement';
            });
    }

    public editResource(resource: ResourceComponent) {
        const modalRef = this.modalService.open(FhirEditCapabilityStatementResourceModalComponent, { size: 'lg' });
        modalRef.componentInstance.resource = resource;
    }

    public copyResource(rest: RestComponent, resource: ResourceComponent) {
        const resourceCopy = JSON.parse(JSON.stringify(resource));
        rest.resource.push(resourceCopy);
    }

    public getDefaultMessagingEvent(): EventComponent {
        return {
            code: this.globals.messageEventCodes[0],
            mode: 'sender',
            focus: 'Account',
            request: { reference: '', display: '' },
            response: { reference: '', display: '' }
        };
    }

    public editEvent(event: EventComponent) {
        const modalRef = this.modalService.open(FhirEditMessagingEventModalComponent, { size: 'lg' });
        modalRef.componentInstance.event = event;
    }

    public selectImplementationGuide(implementationGuideIndex) {
        const modalRef = this.modalService.open(FhirEditReferenceModalComponent);
        modalRef.componentInstance.resourceType = 'ImplementationGuide';
        modalRef.componentInstance.hideResourceType = true;

        modalRef.result.then((results: any) => {
            this.capabilityStatement.implementationGuide[implementationGuideIndex] = results.resource.url || results.fullUrl;
        });
    }

    private getCapabilityStatement(): Observable<CapabilityStatement> {
        const capabilityStatementId  = this.route.snapshot.paramMap.get('id');

        if (capabilityStatementId === 'from-file') {
            if (this.fileService.file) {
                return new Observable<CapabilityStatement>((observer) => {
                    this.capabilityStatement = <CapabilityStatement> this.fileService.file.resource;
                    observer.next(this.capabilityStatement);
                });
            } else {
                this.router.navigate(['/']);
                return;
            }
        }

        return new Observable<CapabilityStatement>((observer) => {
            if (capabilityStatementId) {
                this.csService.get(capabilityStatementId)
                    .subscribe((cs) => {
                        this.capabilityStatement = cs;
                        observer.next(cs);
                    }, (err) => {
                        observer.error(err);
                    });
            }
        });
    }

    ngOnInit() {
        this.getCapabilityStatement()
            .subscribe((cs) => {
                this.recentItemService.ensureRecentItem(
                    this.globals.cookieKeys.recentCapabilityStatements,
                    cs.id,
                    cs.name || cs.title);
            });
    }

    ngDoCheck() {
        this.validation = this.fhirService.validate(this.capabilityStatement);
    }
}
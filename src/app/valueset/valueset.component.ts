import {Component, DoCheck, Input, OnInit} from '@angular/core';
import {ConceptReferenceComponent, ConceptSetComponent, OperationDefinition, ValueSet} from '../models/stu3/fhir';
import {Globals} from '../globals';
import {RecentItemService} from '../services/recent-item.service';
import {ActivatedRoute, Router} from '@angular/router';
import {ValueSetService} from '../services/value-set.service';
import {Observable} from 'rxjs';
import * as _ from 'underscore';
import {NgbModal} from '@ng-bootstrap/ng-bootstrap';
import {FhirService} from '../services/fhir.service';
import {FileService} from '../services/file.service';
import {FhirEditValueSetIncludeConceptModalComponent} from '../fhir-edit/value-set-include-concept-modal/value-set-include-concept-modal.component';

@Component({
    selector: 'app-valueset',
    templateUrl: './valueset.component.html',
    styleUrls: ['./valueset.component.css']
})
export class ValuesetComponent implements OnInit, DoCheck {
    @Input() public valueSet = new ValueSet();
    public message: string;
    public validation: any;

    constructor(
        public globals: Globals,
        private valueSetService: ValueSetService,
        private route: ActivatedRoute,
        private router: Router,
        private modalService: NgbModal,
        private recentItemService: RecentItemService,
        private fileService: FileService,
        private fhirService: FhirService) {
    }

    public get isNew(): boolean {
        const id  = this.route.snapshot.paramMap.get('id');
        return !id || id === 'new';
    }

    public addIncludeEntry(includeTabSet) {
        this.valueSet.compose.include.push({ });
        setTimeout(() => {
            const lastIndex = this.valueSet.compose.include.length - 1;
            const newIncludeTabId = 'include-' + lastIndex.toString();
            includeTabSet.select(newIncludeTabId);
        }, 50);
    }

    public revert() {
        this.getValueSet()
            .subscribe(() => {
                this.message = 'Reverted value set changes';
                setTimeout(() => {
                    this.message = null;
                }, 3000);
            }, (err) => {
                this.message = 'An error occurred while reverting the value set changes';
            });
    }

    public save() {
        const valueSetId = this.route.snapshot.paramMap.get('id');

        if (!this.validation.valid && !confirm('This value set is not valid, are you sure you want to save?')) {
            return;
        }

        if (valueSetId === 'from-file') {
            this.fileService.saveFile();
            return;
        }

        this.valueSetService.save(this.valueSet)
            .subscribe((results: ValueSet) => {
                if (!this.valueSet.id) {
                    this.router.navigate(['/value-set/' + results.id]);
                } else {
                    this.recentItemService.ensureRecentItem(this.globals.cookieKeys.recentValueSets, results.id, results.name);
                    this.message = 'Successfully saved value set!';
                    setTimeout(() => { this.message = ''; }, 3000);
                }
            }, (err) => {
                this.message = 'An error occured while saving the value set';
            });
    }

    public getIncludeCodes(include: ConceptSetComponent) {
        const concepts = _.map(include.concept, (concept) => concept.display || concept.code);
        const ret = concepts.join(', ');

        if (ret.length > 50) {
            return ret.substring(0, 50) + '...';
        }

        return ret;
    }

    private getValueSet(): Observable<ValueSet> {
        const valueSetId  = this.route.snapshot.paramMap.get('id');

        if (valueSetId === 'from-file') {
            if (this.fileService.file) {
                return new Observable<ValueSet>((observer) => {
                    this.valueSet = <ValueSet> this.fileService.file.resource;
                    observer.next(this.valueSet);
                });
            } else {
                this.router.navigate(['/']);
                return;
            }
        }

        return new Observable<ValueSet>((observer) => {
            if (valueSetId === 'new') {
                observer.next(this.valueSet);
            } else if (valueSetId) {
                this.valueSetService.get(valueSetId)
                    .subscribe((vs) => {
                        this.valueSet = vs;
                        observer.next(vs);
                    }, (err) => {
                        observer.error(err);
                    });
            }
        });
    }

    ngOnInit() {
        this.getValueSet()
            .subscribe((vs) => {
                this.recentItemService.ensureRecentItem(
                    this.globals.cookieKeys.recentValueSets,
                    vs.id,
                    vs.name || vs.title);
            });
    }

    ngDoCheck() {
        this.validation = this.fhirService.validate(this.valueSet);
    }
}

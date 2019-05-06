import {Bundle, CapabilityStatement, DomainResource} from '../../../../libs/tof-lib/src/lib/stu3/fhir';
import * as rp from 'request-promise';

export class BaseTools {
  protected getConformance(server: string): Promise<CapabilityStatement> {
    const conformanceUrl = server + (server.endsWith('/') ? '' : '/') + 'metadata';
    return new Promise((resolve, reject) => {
      rp({ url: conformanceUrl, json: true })
        .then((results) => resolve(results))
        .catch((err) => reject(err));
    });
  }

  private getNextResources(url: string, resourceType: string): Promise<DomainResource[]> {
    console.log(`Getting next page of resources of type ${resourceType}`);

    return new Promise((resolve, reject) => {
      rp({ url: url, json: true })
        .then((body: Bundle) => {
          console.log(`Found ${body.total} more resources for ${resourceType}`);

          let resources: DomainResource[] = (body.entry || []).map((entry) => entry.resource);
          const foundNextLink = (body.link || []).find((link) => link.relation === 'next');

          if (foundNextLink) {
            this.getNextResources(foundNextLink.url, resourceType)
              .then((nextResources) => {
                resources = resources.concat(nextResources);
                return resolve(resources);
              })
              .catch((nextErr) => reject(nextErr));
          } else {
            return resolve(resources);
          }
        })
        .catch((err) => reject(err));
    });
  }

  private getAllResourcesByType(server: string, resourceTypes: string[]): Promise<DomainResource[]> {
    return new Promise((resolve, reject) => {
      const nextResourceType = resourceTypes.pop();
      const url = server + (server.endsWith('/') ? '' : '/') + nextResourceType;

      console.log(`Getting all resources of type ${nextResourceType}`);

      this.getNextResources(url, nextResourceType)
        .then((resources) => {
          if (resourceTypes.length > 0) {
            this.getAllResourcesByType(server, resourceTypes)
              .then((nextResources) => {
                resources = resources.concat(nextResources);
                resolve(resources);
              })
              .catch((err) => reject(err));
          } else {
            resolve(resources);
          }
        })
        .catch((err) => reject(err));
    });
  }

  protected getAllResources(server: string): Promise<DomainResource[]> {
    return new Promise((resolve, reject) => {
      this.getConformance(server)
        .then((conformance) => {
          let promises = [];
          const resourceTypes = [];

          (conformance.rest || []).forEach((rest) => {
            (rest.resource || []).forEach((resource) => resourceTypes.push(resource.type));
          });

          return this.getAllResourcesByType(server, resourceTypes);
        })
        .then((allResources) => allResources)
        .catch((err) => reject(err));
    });
  }

  protected getResource(server: string, resourceType: string, id: string): Promise<DomainResource> {
    const options = {
      method: 'GET',
      url: server + (server.endsWith('/') ? '' : '/') + resourceType + '/' + id,
      json: true
    };

    return new Promise((resolve, reject) => {
      rp(options)
        .then((results) => resolve(results))
        .catch((err) => reject(err));
    });
  }

  protected saveResource(server: string, resource: DomainResource) {
    const options = {
      method: 'PUT',
      url: server + (server.endsWith('/') ? '' : '/') + resource.resourceType + '/' + resource.id,
      json: true,
      body: resource
    };
    return rp(options);
  }

  protected printError(err) {
    if (err.error && err.error.resourceType === 'OperationOutcome') {
      if (err.error.issue && err.error.issue.length > 0) {
        err.error.issue.forEach((issue: any) => console.error(issue.diagnostics));
      } else if (err.err.text && err.error.text.div) {
        console.error(err.error.text.div);
      } else {
        console.error(err);
      }
    } else {
      console.error(err);
    }
  }
}
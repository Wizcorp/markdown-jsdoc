/*global env: true */
'use strict';

var template = require('jsdoc/template'),
	fs = require('jsdoc/fs'),
	path = require('jsdoc/path'),
	taffy = require('taffydb').taffy,
	logger = require('jsdoc/util/logger'),
	helper = require('./templateHelper'),
	htmlsafe = helper.htmlsafe,
	linkto = helper.linkto,
	resolveAuthorLinks = helper.resolveAuthorLinks,
	scopeToPunc = helper.scopeToPunc,
	hasOwnProp = Object.prototype.hasOwnProperty,
	data,
	view;

function find(spec) {
	return helper.find(data, spec);
}

function tutoriallink(tutorial) {
	return helper.toTutorial(tutorial, null, { tag: 'em', classname: 'disabled', prefix: 'Tutorial: ' });
}

function getAncestorLinks(doclet) {
	return helper.getAncestorLinks(data, doclet);
}

function hashToLink(doclet, hash) {
	if (!/^(#.+)/.test(hash)) {
		return hash;
	}

	var url = helper.createLink(doclet);

	url = url.replace(/(#.+|$)/, hash);
	return ('[' + hash + '](' + url + ')');
}

function needsSignature(doclet) {
	var needsSig = false;

	// function and class definitions always get a signature
	if (doclet.kind === 'function' || doclet.kind === 'class') {
		needsSig = true;
	}
	// typedefs that contain functions get a signature, too
	else if (doclet.kind === 'typedef' && doclet.type && doclet.type.names &&
		doclet.type.names.length) {
		for (var i = 0, l = doclet.type.names.length; i < l; i++) {
			if (doclet.type.names[i].toLowerCase() === 'function') {
				needsSig = true;
				break;
			}
		}
	}

	return needsSig;
}

function addSignatureParams(f) {
	var params = helper.getSignatureParams(f, 'optional');

	f.signature = (f.signature || '') + '(' + params.join(', ') + ')';
}

function addSignatureReturns(f) {
	var returnTypes = helper.getSignatureReturns(f);

	f.signature = (f.signature || '') + (returnTypes && returnTypes.length ? ' &rarr; {' + returnTypes.join('|') + '}' : '');
}

function addSignatureTypes(f) {
	var types = helper.getSignatureTypes(f);

	f.signature = (f.signature || '') + (types.length ? ' :' + types.join('|') : '');
}

function addAttribs(f) {
	var attribs = helper.getAttribs(f);

	f.attribs = htmlsafe(attribs.length ?
		// we want the template output to say 'abstract', not 'virtual'
		'<_' + attribs.join(', ').replace('virtual', 'abstract') + '_> ' : '');
}

function shortenPaths(files, commonPrefix) {
	Object.keys(files).forEach(function (file) {
		files[file].shortened = files[file].resolved.replace(commonPrefix, '')
			// always use forward slashes
			.replace(/\\/g, '/');
	});

	return files;
}

function getPathFromDoclet(doclet) {
	if (!doclet.meta) {
		return;
	}

	return doclet.meta.path && doclet.meta.path !== 'null' ?
		path.join(doclet.meta.path, doclet.meta.filename) :
		doclet.meta.filename;
}

function generate(title, docs, filename, resolveLinks) {
	resolveLinks = resolveLinks === false ? false : true;

	var docData = {
		title: title,
		docs: docs
	};

	if (!docs[0].meta) {
		// Global
		return;
	}
	var outpath = path.join(docs[0].meta.path, filename);
	var markdown = view.render('container.tmpl', docData);
	markdown = markdown.replace(/\n\n\n+/g, '\n\n');

	if (resolveLinks) {
		markdown = helper.resolveLinks(markdown); // turn {@link foo} into <a href="foodoc.html">foo</a>
	}

	fs.writeFileSync(outpath, markdown, 'utf8');
}

function registerSourceFiles(sourceFiles, encoding) {
	encoding = encoding || 'utf8';
	Object.keys(sourceFiles).forEach(function (file) {
		var fileName = sourceFiles[file].shortened;
		helper.registerLink(fileName, fileName);
	});
}

/**
 * Look for classes or functions with the same name as modules (which indicates that the module
 * exports only that class or function), then attach the classes or functions to the `module`
 * property of the appropriate module doclets. The name of each class or function is also updated
 * for display purposes. This function mutates the original arrays.
 *
 * @private
 * @param {Array.<module:jsdoc/doclet.Doclet>} doclets - The array of classes and functions to
 * check.
 * @param {Array.<module:jsdoc/doclet.Doclet>} modules - The array of module doclets to search.
 */
function attachModuleSymbols(doclets, modules) {
	var symbols = {};

	// build a lookup table
	doclets.forEach(function (symbol) {
		symbols[symbol.longname] = symbol;
	});

	return modules.map(function (module) {
		if (symbols[module.longname]) {
			module.module = symbols[module.longname];
			module.module.name = module.module.name.replace('module:', 'require("') + '")';
		}
	});
}


exports.publish = function (taffyData, opts, tutorials) {
	data = taffyData;
//console.log(env)
	var conf = env.conf.templates || {};
	conf['default'] = conf['default'] || {};

	var templatePath = opts.template;
	view = new template.Template(templatePath + '/tmpl');

	// claim some special filenames in advance, so the All-Powerful Overseer of Filename Uniqueness
	// doesn't try to hand them out later
	var indexUrl = helper.getUniqueFilename('index');
	// don't call registerLink() on this one! 'index' is also a valid longname

	var globalUrl = helper.getUniqueFilename('global');
	helper.registerLink('global', globalUrl);

	// set up templating
	view.layout = conf['default'].layoutFile ?
		path.getResourcePath(path.dirname(conf['default'].layoutFile), path.basename(conf['default'].layoutFile)) :
		'layout.tmpl';

	// set up tutorials for helper
	helper.setTutorials(tutorials);

	data = helper.prune(data);
	data.sort('longname, version, since');
	helper.addEventListeners(data);

	var sourceFiles = {};
	var sourceFilePaths = [];
	data().each(function (doclet) {
		doclet.attribs = '';

		if (doclet.examples) {
			doclet.examples = doclet.examples.map(function (example) {
				var caption, code;

				if (example.match(/^\s*<caption>([\s\S]+?)<\/caption>(\s*[\n\r])([\s\S]+)$/i)) {
					caption = RegExp.$1;
					code = RegExp.$3;
				}

				return {
					caption: caption || '',
					code: code || example
				};
			});
		}
		if (doclet.see) {
			doclet.see.forEach(function (seeItem, i) {
				doclet.see[i] = hashToLink(doclet, seeItem);
			});
		}

		// build a list of source files
		var sourcePath;
		if (doclet.meta) {
			sourcePath = getPathFromDoclet(doclet);
			sourceFiles[sourcePath] = {
				resolved: sourcePath,
				shortened: null
			};
			if (sourceFilePaths.indexOf(sourcePath) === -1) {
				sourceFilePaths.push(sourcePath);
			}
		}
	});

	if (sourceFilePaths.length) {
		sourceFiles = shortenPaths(sourceFiles, path.commonPrefix(sourceFilePaths));
	}

	data().each(function (doclet) {
		var url = helper.createLink(doclet);

		helper.registerLink(doclet.longname, url);

		// add a shortened version of the full path
		var docletPath;
		if (doclet.meta) {
			docletPath = getPathFromDoclet(doclet);
			docletPath = sourceFiles[docletPath].shortened;
			if (docletPath) {
				doclet.meta.shortpath = docletPath;
			}
		}
	});

	data().each(function (doclet) {
		var url = helper.longnameToUrl[doclet.longname];

		if (url.indexOf('#') > -1) {
			doclet.id = helper.longnameToUrl[doclet.longname].split(/#/).pop();
		}
		else {
			doclet.id = doclet.name;
		}

		if (needsSignature(doclet)) {
			addSignatureParams(doclet);
			addSignatureReturns(doclet);
			addAttribs(doclet);
		}
	});

	// do this after the urls have all been generated
	data().each(function (doclet) {
		doclet.ancestors = getAncestorLinks(doclet);

		if (doclet.kind === 'member') {
			addSignatureTypes(doclet);
			addAttribs(doclet);
		}

		if (doclet.kind === 'constant') {
			addSignatureTypes(doclet);
			addAttribs(doclet);
			doclet.kind = 'member';
		}
	});

	var members = helper.getMembers(data);
	members.tutorials = tutorials.children;

	// output pretty-printed source files by default
	var outputSourceFiles = conf['default'] && conf['default'].outputSourceFiles !== false ? true :	false;

	// add template helpers
	view.find = find;
	view.linkto = linkto;
	view.resolveAuthorLinks = resolveAuthorLinks;
	view.tutoriallink = tutoriallink;
	view.htmlsafe = htmlsafe;
	view.outputSourceFiles = outputSourceFiles;


	// generate the pretty-printed source files first so other pages can link to them
	if (outputSourceFiles) {
		registerSourceFiles(sourceFiles, opts.encoding);
	}

	// once for all
	attachModuleSymbols(find({ kind: ['class', 'function'], longname: { left: 'module:' } }), members.modules);


	if (members.globals.length) {
		generate('Global', [
			{ kind: 'globalobj' }
		], globalUrl);
	}

	// index page displays information from package.json and lists files
	var files = find({ kind: 'file' });
	var packages = find({ kind: 'package' });

	// set up the lists that we'll use to generate pages
	var classes = taffy(members.classes);
	var modules = taffy(members.modules);
	var namespaces = taffy(members.namespaces);
	var mixins = taffy(members.mixins);
	var externals = taffy(members.externals);

	Object.keys(helper.longnameToUrl).forEach(function (longname) {
		var myClasses = helper.find(classes, { longname: longname });
		if (myClasses.length) {
			generate('Class: ' + myClasses[0].name, myClasses, helper.longnameToUrl[longname]);
		}

		var myModules = helper.find(modules, { longname: longname });
		if (myModules.length) {
			generate('Module: ' + myModules[0].name, myModules, helper.longnameToUrl[longname]);
		}

		var myNamespaces = helper.find(namespaces, { longname: longname });
		if (myNamespaces.length) {
			generate('Namespace: ' + myNamespaces[0].name, myNamespaces, helper.longnameToUrl[longname]);
		}

		var myMixins = helper.find(mixins, { longname: longname });
		if (myMixins.length) {
			generate('Mixin: ' + myMixins[0].name, myMixins, helper.longnameToUrl[longname]);
		}

		var myExternals = helper.find(externals, { longname: longname });
		if (myExternals.length) {
			generate('External: ' + myExternals[0].name, myExternals, helper.longnameToUrl[longname]);
		}
	});

	// TODO: move the tutorial functions to templateHelper.js
	function generateTutorial(title, tutorial, filename) {
		var tutorialData = {
			title: title,
			header: tutorial.title,
			content: tutorial.parse(),
			children: tutorial.children
		};

		var tutorialPath = path.join('./', filename);
		var markdown = view.render('tutorial.tmpl', tutorialData);
		markdown = markdown.replace(/\n+/g, '\n');
		// yes, you can use {@link} in tutorials too!
		markdown = helper.resolveLinks(markdown); // turn {@link foo} into <a href="foodoc.html">foo</a>

		fs.writeFileSync(tutorialPath, markdown, 'utf8');
	}

	// tutorials can have only one parent so there is no risk for loops
	function saveChildren(node) {
		node.children.forEach(function (child) {
			generateTutorial('Tutorial: ' + child.title, child, helper.tutorialToUrl(child.name));
			saveChildren(child);
		});
	}

	saveChildren(tutorials);
};

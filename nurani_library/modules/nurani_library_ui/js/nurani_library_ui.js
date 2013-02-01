var NL = (function ($) {

  /**
   * Util library.
   */
  function Util() {
  }

  // Globally available Util
  var util = new Util();

  // paulirish.com/2009/log-a-lightweight-wrapper-for-consolelog/
  var log = function f(){ log.history = log.history || []; log.history.push(arguments); if(this.console) { var args = arguments, newarr; args.callee = args.callee.caller; newarr = [].slice.call(args); if (typeof console.log === 'object') log.apply.call(console.log, console, newarr); else console.log.apply(console, newarr);}};


  /**
   * Capitalizes the first letter of a string.
   * @see: http://stackoverflow.com/a/1026087/806988
   */
  Util.prototype.capitalize = function (string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  };

  Util.prototype.findByName = function (array, name) {
    var search, key;
    search = $.grep(array, function (o, i) { return o.name == name; });
    return search.length > 0 ? $.extend({ _key: array.indexOf(search[0]) }, search[0]) : false;
  };

  /**
   * Helper method, set informational messages which disappear after a set amount
   * of time.
   */
  Util.prototype.setMessage = function (prepend_to, message, type, hide_after) {
    type       = type || 'ok';
    hide_after = hide_after || 4000;

    classes = ['messages'];
    if (type) {
      classes.push(type);
    }

    var message = $('<div class="' + classes.join(' ') + '" style="display: none;">' + message + '</div>');
    prepend_to.prepend(message);
    message.slideDown();

    setTimeout(function () {
      message.slideUp(function () {
        $(this).remove();
      });
    }, hide_after);
  }

  /**
   * Main controller object for the bundle UI.
   */
  function PickerUI(opts) {
    this.defaults = {
      osisIDWork: '',
      osisID:     '',
    };

    this.opts  = $.extend(this.defaults, opts);
    this.state = {};

    // The alternateWorks system appends the selected works together. The first
    // is the original text chosen and the subsequent works are the alternates.
    if (this.opts.osisIDWork) {
      this.opts.osisIDWorkParts = this.opts.osisIDWork.split(',');
    }
    if (this.opts.osisID) {
      this.opts.osisIDParts = this.opts.osisID.split('.');
    }

    this.init();

    return this;
  }

  /**
   * Main initialization routine which kicks off subsequent initializations.
   */
  PickerUI.prototype.init = function () {
    // Contents of div.toolbar and div.passages is populated via handlebars.js templates
    this.$element = $('<div class="passage-picker-ui"><div class="toolbar"></div><div class="alternateWorks"></div><div class="passages"></div></div>');

    // Render the initial templates, empty
    this.templates = {};
    this.viewData = { works: [], passages: [] };
    this.renderViews();

    // Use the Bible-Passage-Reference-Parser, if available
    if (typeof bcv_parser === 'function') {
      this.bcv = new bcv_parser;
      this.bcv.set_options({
        book_alone_strategy: 'include',
        book_sequence_strategy: 'include'
      });
    } else {
      this.bcv = false;
    }

    // Kick off data loading for the app. This will load works and passage data
    // for the default selected work.
    this.populateWorks(true, true);
  };

  /**
   * Initialize the elements in the toolbar. This is called dynamically when the
   * toolbar view is loaded.
   */
  PickerUI.prototype.initToolbar = function ($toolbar) {
    var that = this;

    // Bind search box actions
    $('#edit-search-submit', $toolbar).click(function () { that.searchAction(null, this); return false; });
    $('#edit-search', $toolbar)
      .keydown(function (e) {
        var keyCode = e.keyCode || e.which;
        // <Enter> and <Tab> are valid ways to search
        if (keyCode == 13 || keyCode == 9) {
          e.preventDefault();
          that.searchAction(null, this);
        }
      });

    // Bind select box switching actions
    $('#edit-work-filter', $toolbar).change(function () {    that.chooseWorkAction($(this).val(), this); });
    $('#edit-book-filter', $toolbar).change(function () {    that.chooseBookAction($(this).val(), this); });
    $('#edit-chapter-filter', $toolbar).change(function () { that.chooseChapterAction($(this).val(), this); });
  };

  /**
   * Initialize the elements in the passages list. This is called dynamically
   * when the passages view is loaded.
   */
  PickerUI.prototype.initPassages = function ($passages) {
    var that = this;
    // Bind passage selection tickboxes to their action
    $('.form-item-passage', $passages).click(function () { that.pickPassageAction($(this).val(), this); });
    // Bind passage hover action to display button for creating new annotation
    $('tr.passage-row td.annotations', $passages).click(function () { that.annotationsHoverInAction(this); });
    $('tr.passage-row td.annotations', $passages).mouseenter(function () { that.annotationsHoverInAction(this); });
    $('tr.passage-row td.annotations', $passages).mouseleave(function () { that.annotationsHoverOutAction(this); });
  };

  /**
   * Initialize the annotations on passages. This is called dynamically
   * when the passages view is loaded or a new annotation is added.
   */
  PickerUI.prototype.initAnnotations = function ($annotations) {
    var that = this;
    $('.save-annotation-action', $annotations).click(function () { that.annotationSaveAction($(this).parents('.annotation'), this); return false; });
    $('.cancel-annotation-action', $annotations).click(function () { that.annotationCancelAction($(this).parents('.annotation'), this); return false; });
  };

  /**
   * (Re)renders app views selectively. If the views do not exist yet, they will
   * be loaded from templates.
   */
  PickerUI.prototype.renderViews = function (toRender) {
    var func, $el;
    toRender = toRender || ['toolbar', 'alternateWorks', 'passages'];

    for (var i = toRender.length - 1; i >= 0; i--) {
      $el = this.$element.find('.' + toRender[i]);
      // Compile handlebars.js templates as needed
      // @see: PickerUI.templates.js
      if (!this.templates[toRender[i]]) {
        this.templates[toRender[i]] = Handlebars.compile(PickerUI.templates[toRender[i]]);
      }
      $el.html(this.templates[toRender[i]](this.viewData));

      // Call the initializer for this view
      func = 'init' + util.capitalize(toRender[i]);
      if (typeof this[func] === 'function') {
        this[func]($el);
      }
    }
  };

  /**
   * Fetches works from the Nurani Library using the JSON API. When fetched the
   * appropriate views are updated.
   */
  PickerUI.prototype.populateWorks = function (andPassages, setDefaultState) {
    var that = this;

    $.ajax({
      url: Drupal.settings.nuraniLibrary.apiBasePath + 'work?format=jsonp&callback=?',
      dataType: 'jsonp',
      success: function (data) {
        that.viewData.works = that.unpackWorkData(data);

        that.setFilterOptions(['work', 'book', 'chapter'], setDefaultState ? ['work', 'book', 'chapter'] : null);

        that.renderViews(['toolbar', 'alternateWorks']);

        if (andPassages) {
          that.populatePassages(setDefaultState);
        }
      }
    });
  };

  /**
   * Fetches passages, corresponding to the current selected work, book and
   * chapter, from the Nurani Library using the JSON API. When fetched the
   * appropriate views are updated.
   */
  PickerUI.prototype.populatePassages = function (setDefaultState) {
    if (!this.viewData.page) {
      this.viewData.page = 0;
    }

    var that  = this,
        query = {
          work_name: this.viewData.selectedWork.name,
          book:      this.viewData.selectedBook.name,
          chapter:   this.viewData.selectedChapter.name,
          page:      this.viewData.page, // TODO: Pagination??
          pagesize:  500, // FIXME: Fixed page size will cause any really long chapters to be chopped off.
          format:    'jsonp',
          callback:  '?'
        };

    $.ajax({
      url: Drupal.settings.nuraniLibrary.apiBasePath + 'passage?' + $.param(query),
      dataType: 'jsonp',
      success: function (data) {
        var i, iLen = data.length,
            j, jLen,
            parts, firstVerse, lastVerse, passage,
            note;

        if (setDefaultState && that.opts.osisID && that.opts.osisIDParts[2]) {
          parts = that.opts.osisIDParts[2].split('-');
          firstVerse = parseInt(parts[0], 10);
          lastVerse = parts.length == 2 ? parseInt(parts[1], 10) : firstVerse;
        } else {
          setDefaultState = false;
        }

        for (i = 0; i < iLen; i++) {
          passage = data[i];
          passage.osisID    = [passage.book_name, passage.chapter_name, passage.verse].join('.');
          passage.cssId    = 'edit-passage-' + passage.osisID.replace(/\./g, '-');
          passage.verseUrl = Drupal.settings.nuraniLibrary.apiBasePath + 'passages/' + passage.work_name + '/' + passage.osisID;

          if (setDefaultState && passage.verse >= firstVerse && passage.verse <= lastVerse) {
            passage.selected = true;
          }

          jLen = passage.notes ? passage.notes.length : 0;
          for (j = 0; j < jLen; j++) {
            note = passage.notes[j];
            note.title = that.passageTitle(passage);

            passage.notes[j] = note;
          }

          data[i] = passage;
        }

        that.viewData.passages = data;
        that.renderViews(['passages']);

        if (that.state.highlightVerses) {
          that.highlightVerses(that.state.highlightVerses);
          that.state.highlightVerses = false;
        } else {
          that.$element.animate({ scrollTop: 0 });
        }
      }
    });
  };


  /**
   * Responds to the user interaction to perform a search. Uses the
   * Bible-Passage-Reference-Parser to turn the search query into OSIS format.
   */
  PickerUI.prototype.searchAction = function () {
    var search = $('#edit-search', this.$element).val(),
        osises = this.bcv.parse(search).osis_and_indices(),
        did_search = search.length > 0 ? false : true,
        osisParts,
        book, chapter, verse;

    this.viewData.currentSearch = search;

    if (osises.length > 0) {
      osisParts = osises[0].osis.split('.');
      book = util.findByName(this.viewData.selectedWork.books, osisParts[0]);

      // Matched book
      if (book) {
        this.viewData.selectedBook = book;
        chapter = util.findByName(this.viewData.selectedBook.chapters, osisParts[1]);

        // Matched chapter
        if (chapter) {
          this.viewData.selectedChapter = chapter;
          verse = osisParts[2];
        }

        this.renderViews(['toolbar']);
        this.populatePassages();
        did_search = true;

        // Matched verse, attempt to highlight it when view is loaded
        if (verse) {
          this.state.highlightVerses = [verse];
        }
      }
    }

    if (!did_search) {
      this.setMessage(Drupal.t('Could not find any passages matching "@search". Try using the format "Book chapter:verse", eg: "John 3:16".', { '@search': search }), 'warning');
    }
  };

  /**
   * Responds to the user changing the work <select> field.
   */
  PickerUI.prototype.chooseWorkAction = function (chosenWork) {
    this.viewData.selectedWork = util.findByName(this.viewData.works, chosenWork);
    this.setFilterOptions(['book', 'chapter']);
    this.renderViews(['toolbar', 'alternateWorks']);
    this.populatePassages();
  };

  /**
   * Responds to the user changing the book <select> field.
   */
  PickerUI.prototype.chooseBookAction = function (chosenBook) {
    this.viewData.selectedBook = util.findByName(this.viewData.selectedWork.books, chosenBook);
    this.setFilterOptions(['chapter']);
    this.renderViews(['toolbar']);
    this.populatePassages();
  };

  /**
   * Responds to the user changing the chapter <select> field.
   */
  PickerUI.prototype.chooseChapterAction = function (chosenChapter) {
    this.viewData.selectedChapter = util.findByName(this.viewData.selectedBook.chapters, chosenChapter);
    this.populatePassages();
  };

  /**
   * Response to the user clicking on a passage checkbox.
   */
  PickerUI.prototype.pickPassageAction = function (osisID, el) {
    var $el = $(el),
        $checkboxes = $('.form-item-passage', this.$element),
        originI = $checkboxes.index(el);

    if ($el.attr('checked')) {
      // Determine the contiguous group el checkbox belongs to then remove
      // all other ticked boxes
      var first = this.contiguous($checkboxes, originI, -1),
          last = this.contiguous($checkboxes, originI,  1),
          firstVerse = parseInt(first.split('.')[2], 10),
          lastVerse = parseInt(last.split('.')[2], 10);

      $checkboxes.each(function () {
        var $this = $(this),
            parts = $this.val().split('.'),
            verse = parseInt(parts[2], 10);

        if (verse < firstVerse || verse > lastVerse) {
          $this.removeAttr('checked');
        }
      });

      if (this.viewData.alternateWorks.length > 0) {
        this.showAlternateWorks();
      }
    } else if ($checkboxes.filter('[checked]').length == 0) {
      this.hideAlternateWorks();
    }
  }

  /**
   * Handles adding the 'new annotation' bubble.
   */
  PickerUI.prototype.annotationsHoverInAction = function (el) {
    // If another new annotation is already in progress
    if ($('.annotation.new', el).length > 0) {
      return;
    }

    // FIXME: It's expensive to compile handlebars this often.
    var that     = this,
        $el      = $(el),
        template = Handlebars.compile('{{> annotation}}'),
        i        = $el.siblings('td.passage').find('input.form-item-passage').data('index'),
        passage  = this.viewData.passages[i],
        $annotation;

    // Creates a new blank annotation with the form displayed
    $annotation = $(template({
      editing:           true,
      new:               true,
      id:                '',
      passage_id:        passage.id,
      author_uuid:       '', // Automatically set on the server
      type:              'annotation',
      value:             '',
      title:             'Annotation on ' + this.passageTitle(passage),
      verse:             passage.verse,
      position:          passage.text.split(' ').length, // Last word
      length:            0,
    }));
    this.initAnnotations($annotation);
    $el.append($annotation);

    $('#edit-value', $el).focusout(function (e) {
      // FIXME: The hover out action should not fire when focus is off but mouse
      //        is still inside the annotation box.
      that.annotationsHoverOutAction($(this).parents('td')[0]);
    });
  };

  /**
   * Handles removing the 'new annotation' bubble.
   */
  PickerUI.prototype.annotationsHoverOutAction = function (el) {
    $('.annotation.new', this.$passages).each(function () {
      var $this = $(this),
          $value = $this.find('#edit-value');

      if ($value.val() == '' && !$value.is(':focus')) {
        $this.remove();
      }
    });
  };

  PickerUI.prototype.annotationSaveAction = function ($annotation, el) {
    $.ajax({
      url: Drupal.settings.nuraniLibrary.apiBasePath + 'annotation',
      type: 'POST',
      data: $('.annotation-form', $annotation).serialize(),
      success: function (data) {
        console.log(data);
      },
      error: function (xhr, textStatus, error) {
        console.log({'xhr': xhr, 'textStatus': textStatus, 'error': error});
      }
    });
  };

  PickerUI.prototype.annotationCancelAction = function ($annotation, el) {
    console.log($annotation, 'cancel');
  };


  /**
   * Expands compressed / encoded JSON data returned by the Nurani Library API.
   */
  PickerUI.prototype.unpackWorkData = function (data) {
    var i,  j,  k,
        books, chapters,
        range;

    for (i = data.length - 1; i >=0; i--) {
      books = data[i].books;

      for (j = books.length - 1; j >= 0; j--) {
        chapters = data[i].books[j].chapters;

        // Unpack the chapters: 'START-END' format
        if (typeof chapters === 'string') {
          range = chapters.split('-');

          chapters = [];
          for (k = range[0]; k <= range[1]; k++) {
            chapters.push({
              name: k,
              full_name: k
            });
          }
        }
        // Unpack the duplicate chapter name format, eg: chapters: [1, 2, 3]
        else if ($.isArray(chapters)) {
          for (k = chapters.length - 1; k >= 0; k--) {
            if (typeof chapters[k] !== 'object') { // Find 'number' and 'string'
              chapter[k] = {
                name: chapter[k],
                full_name: chapter[k]
              };
            }
          }
        }

        data[i].books[j].chapters = chapters;
      }
    }

    return data;
  };

  /**
   * Sets the options available for a filter. Used to set up state of the toolbar
   * view.
   *
   * @param "object" toClear
   *  Array having values: 'work', 'book', or 'chapter'.
   */
  PickerUI.prototype.setFilterOptions = function (toClear, toDefault) {
    var i, j, len, type, objects, defaultsMap;

    toClear   = toClear   || [];
    toDefault = toDefault || [];

    for (i = toClear.length - 1; i >= 0; i--) {
      this.viewData['selected' + util.capitalize(toClear[i])] = false;
    }

    // Only set defaults if:
    // (a) There are defaults to set and
    // (b) It was requested (ie: if toDefault empty the loop won't run)
    if (this.opts.osisIDWork && this.opts.osisID) {
      defaultsMap = {
        work:    this.opts.osisIDWorkParts[0],
        book:    this.opts.osisIDParts[0],
        chapter: this.opts.osisIDParts[1]
      };

      for (i = 0, len = toDefault.length; i < len; i++) {
        type = toDefault[i];

        // Skip unknown types
        objects = [];
        switch (type) {
          case 'work':    objects = this.viewData.works; break;
          case 'book':    objects = this.viewData.selectedWork.books; break;
          case 'chapter': objects = this.viewData.selectedBook.chapters; break;
        }

        for (j = objects.length - 1; j >= 0; j--) {
          if (objects[j].name == defaultsMap[type]) {
            this.viewData['selected' + util.capitalize(type)] = objects[j];
            this.viewData['selected' + util.capitalize(type)]._key = j;
          }
        }
      }
    }


    if (!this.viewData.selectedWork) {
      this.viewData.selectedWork = this.viewData.works[0];
      this.viewData.selectedWork._key = 0;
    }
    if (!this.viewData.selectedBook) {
      this.viewData.selectedBook = this.viewData.selectedWork.books[0];
      this.viewData.selectedBook._key = 0;
    }
    if (!this.viewData.selectedChapter) {
      this.viewData.selectedChapter = this.viewData.selectedBook.chapters[0];
      this.viewData.selectedChapter._key = 0;
    }

    this.setAlternateWorks(this.viewData.selectedWork, this.viewData.selectedBook, this.viewData.selectedChapter, toDefault.indexOf('work') != -1);
  }

  /**
   * Similar to setFilterOptions, this sets the state of the alternateWorks view.
   */
  PickerUI.prototype.setAlternateWorks = function (originWork, originBook, originChapter, setDefaults) {
    var i, j, k,
        work, book, chapter;

    setDefaults = typeof setDefaults !== 'undefined' ? setDefaults : false;

    this.viewData.alternateWorks = [];
    for (i = this.viewData.works.length - 1; i >=0; i--) {
      work = this.viewData.works[i];

      // Don't also add the origin work as an alternate work
      if (work.name == originWork.name) {
        continue;
      }

      for (j = work.books.length - 1; j >= 0; j--) {
        book = work.books[j];

        // This work contains the same book as the origin, next check if has
        // the same chapter too
        if (book.name == originBook.name) {
          for (k = book.chapters.length - 1; k >= 0; k--) {
            chapter = book.chapters[k];

            // This work contains the same book and chapter as the origin
            // that means that almost certainly it is a valid alternate work
            if (chapter.name == originChapter.name) {
              // Need to make a deep copy here, else alternateWorks stae will be
              // bound to works!
              this.viewData.alternateWorks.push($.extend(true, {}, work));
              break; // Successful match found, quit searching chapters
            }
          }
          break; // Matched book, quit searching books
        }
      }
    }

    if (this.viewData.alternateWorks.length == 0) {
      this.hideAlternateWorks(false);
    } else {
      if (setDefaults && this.opts.osisIDWork && this.opts.osisIDWorkParts.length > 1) {
        var alternate,
            alternates = this.opts.osisIDWorkParts.slice(1);

        for (i = this.viewData.alternateWorks.length - 1; i >= 0; i--) {
          alternate = this.viewData.alternateWorks[i];

          if (alternates.indexOf(alternate.name) != -1) {
            this.viewData.alternateWorks[i].selected = true;
          }
        }
      }

      this.showAlternateWorks(false);
    }
  };

  /**
   * Displays the alternateWorks view.
   */
  PickerUI.prototype.showAlternateWorks = function (animated) {
    var that = this,
        selector, css,
        ops  = {
          // FIXME: This hardcoded height will break if too many alternate works are listed
          '.alternateWorks': { height: 36 },
          '.passages': { paddingTop: 70 + 2 + 36 - 6 }
        };

    animated = typeof animated !== 'undefined' ? animated : true;

    for (selector in ops) {
      if (ops.hasOwnProperty(selector)) {
        css = ops[selector];

        if (animated) {
          $(selector, this.$element).animate(css, 'fast');
        } else {
          $(selector, this.$element).css(css);
        }
      }
    }
  };

  /**
   * Hides the alternateWorks view.
   */
  PickerUI.prototype.hideAlternateWorks = function (animated) {
    var that = this,
        selector, css,
        ops  = {
          '.alternateWorks': { height: 0 },
          '.passages': { paddingTop: 70 + 5 }
        };

    animated = typeof animated !== 'undefined' ? animated : true;

    for (selector in ops) {
      if (ops.hasOwnProperty(selector)) {
        css = ops[selector];

        if (animated) {
          $(selector, this.$element).animate(css, 'fast');
        } else {
          $(selector, this.$element).css(css);
        }
      }
    }
  };

  /**
   * Highlights a group of verses and scrolls the view such that they are visible.
   */
  PickerUI.prototype.highlightVerses = function(verses, hideAfter) {
    var i, offset, $passageRow;

    hideAfter = hideAfter || 3000;

    for (var i = verses.length - 1; i >= 0; i--) {
      $passageRow = $('.form-item-passage-row-' + verses[i], this.$element);

      // Scroll down to the first passage
      if (i == 0) {
        this.$element.animate({ scrollTop: this.$element.scrollTop() + $passageRow.position().top - this.$element.height()/2 });
      }
      // Fade the background colour into yellow
      $passageRow.animate({ backgroundColor: '#ffff66' });

      // After pausing, fade the background colour back to white, then remove
      // the background color.
      setTimeout(function () {
        $passageRow.animate({ backgroundColor: '#fff' }, 'slow', function () {
          $(this).css('backgroundColor', null);
        });
      }, hideAfter);
    };
  };

  /**
   * Returns the current OSIS range as defined by the picked passages.
   */
  PickerUI.prototype.getSelectionOSIS = function ($origin) {
    $origin = $origin || $('.form-item-passage[checked]:first', this.$element);

    var first = $origin.val(),
        last = $origin.val(),
        $checkboxes = $('.form-item-passage', this.$element),
        length = $checkboxes.length,
        originI = $checkboxes.index($origin),
        firstParts, lastParts, osisID, osisIDWork;

    if (originI >= 0) {
      // Iterate backwards and forwards to find boundaries of this contiguously
      // checked group.
      first = this.contiguous($checkboxes, originI, -1);
      last  = this.contiguous($checkboxes, originI,  1);

      firstParts = first.split('.');
      lastParts = last.split('.');

      osisID = [];
      osisID.push(firstParts[0]);
      osisID.push(firstParts[1]);

      if (firstParts[2] != lastParts[2]) {
        osisID.push(firstParts[2] + '-' + lastParts[2]);
      } else {
        osisID.push(firstParts[2]);
      }

      osisIDWork = [$('#edit-work-filter', this.$element).val()];
      $('input.form-item-alternate-works', this.$element).each(function () {
        if (this.checked) {
          osisIDWork.push($(this).val());
        }
      })

      return {
        osisIDWork: osisIDWork.join(','),
        osisID: osisID.join('.')
      }
    }

    this.setMessage(Drupal.t('A passage must be selected.'), 'error');
    return false;
  };

  /**
   * Returns the contiguous range of ticked checkboxes when traversing in
   * a specific direction.
   */
  PickerUI.prototype.contiguous = function ($checkboxes, i, dir, bound) {
    bound = $checkboxes[i].value;

    // Failsafe
    if (dir != -1 && dir != 1) {
      return '';
    }

    if (i + dir >= 0 && i + dir < $checkboxes.length && $checkboxes[i + dir].checked) {
      return this.contiguous($checkboxes, i + dir, dir, bound);
    } else {
      return bound;
    }
  };

  /**
   * Integration with the Picker jQuery UI dialog. Resize this interface when
   * the jQuery UI dialog is resized.
   */
  PickerUI.prototype.didResize = function () {
    this.$element.find('.toolbar,.alternateWorks').css('width', this.$element.width());
  };

  /**
   * Renders an error/warning message for the user to see.
   */
  PickerUI.prototype.setMessage = function (message, type, hideAfter) {
    hideAfter = hideAfter || null;
    util.setMessage($('.passages', this.$element), message, type, hideAfter);
  };

  PickerUI.prototype.passageTitle = function (passage) {
    return passage.book_full_name + ' ' + passage.chapter_full_name + ':' + passage.verse;
  };

  // Static template for the picker UI. Handlebars compiles this shared template
  // into a specific HTML blob for each PickerUI instance.
  PickerUI.templates = {
    toolbar: [
      // Search box
      '<div class="form-item form-type-textfield form-item-search">',
        '<label for="edit-search">',
          'Search for a passage ',
        '</label>',
        '<input type="text" id="edit-search" name="search" value="{{currentSearch}}" size="30" maxlength="1024" class="form-text required">',
      '</div>',
      '<input class="search-action form-submit" type="submit" id="edit-search-submit" name="op" value="Search">',
      // Chapter filter
      '<div class="form-item form-type-select form-item-chapter-filter">',
        '<label for="edit-chapter-filter">',
          'Chapter ',
        '</label>',
        '<select id="edit-chapter-filter" name="chapterFilter" class="form-select">',
          '{{#eachOption selectedBook.chapters selectedChapter}}',
            '<option value="{{name}}"{{selected this "selected"}}>{{full_name}}</option>',
          '{{/eachOption}}',
        '</select>',
      '</div>',
      // Book filter
      '<div class="form-item form-type-select form-item-book-filter">',
        '<label for="edit-book-filter">',
          'Book ',
        '</label>',
        '<select id="edit-book-filter" name="bookFilter" class="form-select">',
          '{{#eachOption selectedWork.books selectedBook}}',
            '<option value="{{name}}"{{selected this "selected"}}>{{full_name}}</option>',
          '{{/eachOption}}',
        '</select>',
      '</div>',
      // Works filter
      '<div class="form-item form-type-select form-item-work-filter">',
        '<label for="edit-work-filter">',
          'Text ',
          '<span class="form-required" title="This field is required.">*</span>',
        '</label>',
        '<select id="edit-work-filter" name="workFilter" class="form-select required">',
          '{{#eachOption works selectedWork}}',
            '<option value="{{name}}"{{selected this "selected"}}>{{full_name}}</option>',
          '{{/eachOption}}',
        '</select>',
      '</div>'
    ].join(''),

    alternateWorks: [
      '<div class="inner clearfix">',
        '<label>',
          'Additional translations to display ',
        '</label>',
        '{{#each alternateWorks}}',
          '<div class="form-item form-type-checkbox form-item-alternate-works">',
            '<input type="checkbox" id="{{cssId}}" name="alternateWorks[]" value="{{name}}" class="form-checkbox form-item-alternate-works"{{selected this "checked"}}> ',
            '<label class="option" for="{{cssId}}">',
              '{{full_name}}',
            '</label>',
          '</div>',
        '{{/each}}',
      '</div>'
    ].join(''),

    passages: [
      '<table>',
        '<tbody>',
          '{{#each passages}}',
            '{{#isChapterBeginning this}}',
              '<tr class="heading">',
                '<td class="passage">',
                  '<h4>{{book_full_name}}, Chapter {{chapter_full_name}}</h4>',
                '</td>',
                '<td class="annotations">',
                '<h4>Annotations</h4>',
                '</td>',
              '</tr>',
            '{{/isChapterBeginning}}',
            '<tr class="passage-row {{oddOrEven verse}}">',
              '<td class="passage">',
                '<div class="form-item form-type-checkbox form-item-passage-row form-item-passage-row-{{verse}} {{work_language}}">',
                  // "Select passage" tickbox
                  '<input type="checkbox" id="{{cssId}}" name="passage[]" value="{{osisID}}" data-index="{{@index}}" class="form-checkbox form-item-passage"{{selected this "checked"}}> ',
                  // The verse and its number link
                  '<label class="option" for="{{cssId}}">',
                    '<span class="verse">',
                      // TODO: When ready, link to verses in the Nurani Library.
                      // '<a href="{{verseUrl}}">{{verse}}</a>',
                      '<strong>{{verse}}</strong>',
                    '</span> ',
                    // NOTE: triple '{{{.}}}' for RAW output. This is coming direct from
                    // the Nurani Library server and should not be an XSS vector.
                    '{{{text}}}',
                  '</label>',
                '</div>',
              '</td>',
              '<td class="annotations">',
                '{{#each notes}}',
                  '{{> annotation}}',
                '{{/each}}',
              '</td>',
            '</tr>',
          '{{/each}}',
        '</tbody>',
      '</table>',
    ].join('')
  };

  PickerUI.partials = {
    annotation: [
      '<div class="annotation {{annotationClasses this}}">',
        '<div class="arrow">◀</div>',
        '<div class="inner">',
          '<h5 class="title">{{title}}</h5>',
          '{{#if editing}}',
            '<form class="annotation-form" method="POST">',
              '<div class="form-item form-type-textarea form-item-value">',
                '<div class="form-textarea-wrapper">',
                  '<textarea id="edit-value" name="value" cols="10" rows="5" class="form-textarea">{{value}}</textarea>',
                '</div>',
              '</div>',
              '<div class="actions clearfix">',
                '<a href="#" class="cancel-annotation-action">Cancel</a>',
                '<input class="save-annotation-action form-submit" type="submit" id="edit-save-annotation-submit" name="op" value="Save">',
              '</div>',
              '<input type="hidden" name="id" value="{{id}}">',
              '<input type="hidden" name="passage_id" value="{{passage_id}}">',
              '<input type="hidden" name="author_uuid" value="{{author_uuid}}">',
              '<input type="hidden" name="type" value="{{type}}">',
              '<input type="hidden" name="position" value="{{position}}">',
              '<input type="hidden" name="length" value="{{length}}">',
              '</form>',
          '{{else}}',
            '<span>{{truncate value 120}}</span>',
          '{{/if}}',
        '</div>',
      '</div>'
    ].join(''),

    annotationForm: [
      '<div class="annotation-form">',
        '<div class="form-item form-type-textarea form-item-value">',
          '<label for="edit-value">Annotate {{book_full_name}} {{chapter_full_name}}:{{verse}}</label>',
          '<div class="form-textarea-wrapper">',
            '<textarea id="edit-value" name="value" cols="10" rows="5" class="form-textarea">{{value}}</textarea>',
          '</div>',
        '</div>',
        '<div class="actions">',
          '<a href="#">Cancel</a>',
          '<input class="save-annotation-action form-submit" type="submit" id="edit-save-annotation-submit" name="op" value="Save">',
        '</div>',
      '</div>',
    ].join('')
  }

  $(function () {

    // Register all partials
    for (var key in PickerUI.partials) {
      if (PickerUI.partials.hasOwnProperty(key)) {
        Handlebars.registerPartial(key, PickerUI.partials[key]);
      }
    }

    /**
     * Handlebars.js helper, detects first chapter and verse condition
     */
    Handlebars.registerHelper('isBookBeginning', function (passage, options) {
      if (passage.chapterName == 1) {
        return options.fn(this);
      }
    });

    /**
     * Handlebars.js helper, detects first chapter and verse condition
     */
    Handlebars.registerHelper('isChapterBeginning', function (passage, options) {
      if (passage.verse == 1) {
        return options.fn(this);
      } else {
        return options.inverse(this);
      }
    });

    /**
     * Extension of the 'each' helper which marks each item as selected or not.
     */
    Handlebars.registerHelper('eachOption', function(context, selected, options) {
      var fn = options.fn, inverse = options.inverse;
      var ret = "", data;

      if (options.data) {
        data = Handlebars.createFrame(options.data);
      }

      if (context && context.length > 0) {
        for (var i = 0, j = context.length; i < j; i++) {
          if (data) { data.index = i; }
          ret = ret + fn($.extend({ selected: (context[i].name == selected.name) }, context[i]), { data: data });
        }
      } else {
        ret = inverse(this);
      }

      return ret;
    });

    /**
     * Helps selecting / checking <option></option> and <input> tags.
     */
    Handlebars.registerHelper('selected', function (context, label) {
      label = label || 'selected';
      return new Handlebars.SafeString(context.selected ? ' ' + label + '="' + label + '"' : '');
    });

    /**
     * Helps truncating strings of text.
     */
    Handlebars.registerHelper('truncate', function (string, length) {
      length = length || 120;

      if (string.length > length) {
        // TODO: More/less for truncated text
        string = [
          // '<span class="short">',
            string.substr(0, length) + '&hellip;',
            // '<a href="" onclick="jQuery(this).parent(\'\').siblings(\'\')">[more]</a>',
          // '</span>'
        ].join('');
      }
      return new Handlebars.SafeString(string);
    });

    /**
     * Helps adding odd or even classes
     */
    Handlebars.registerHelper('oddOrEven', function (row) {
      return new Handlebars.SafeString(row % 2 == 0 ? 'even' : 'odd');
    });

    /**
     * A ternary operator.
     *
     * Eg:
     *  {{ternary true  "1" "2"}} -> "1"
     *  {{ternary false "1" "2"}} -> "2"
     */
    Handlebars.registerHelper('ternary', function (context, ifTrue, ifFalse) {
      ifFalse = ifFalse || '';
      return new Handlebars.SafeString(context ? ifTrue : ifFalse);
    });

    /**
     * A ternary operator.
     *
     * Eg:
     *  {{ternary true  "1" "2"}} -> "1"
     *  {{ternary false "1" "2"}} -> "2"
     */
    Handlebars.registerHelper('annotationClasses', function (annotation) {
      classes = ['annotation'];
      if (annotation.type != 'annotation') {
        classes.push(annotation.type);
      }
      if (annotation.new) {
        classes.push('new');
      }
      if (annotation.editing) {
        classes.push('editing');
      }
      return new Handlebars.SafeString(classes.join(' '));
    });

  });

  return {PickerUI: PickerUI};

})(jQuery);